import { ClassModel, SectionModel } from '../academics/academics.models';
import { ApiError } from '../../lib/api-error';
import { AttendanceModel } from '../attendance/attendance.models';
import { MessageHistoryModel } from '../communication/messaging.models';
import { ExamMarkModel, ExamModel } from '../exams/exams.models';
import { sendBulk } from '../../lib/messaging-provider';
import type { ReportData } from '../reports/reports.service';
import { StaffAttendanceModel, StaffModel } from '../staff/staff.models';
import { StudentModel } from '../students/student.model';
import { TeacherClassModel } from '../teacher/teacher.models';
import { UserModel } from '../user/user.model';
import { StaffLeaveModel, StudentLeaveModel } from './coordinator.models';

type Doc = Record<string, unknown> & { _id: unknown };
const nowIso = (): string => new Date().toISOString();
const keyOf = (className: string, section: string): string => `${className}-${section}`;

async function assignedClassesOf(userId: string): Promise<string[]> {
  const user = await UserModel.findById(userId).lean();
  return (user?.assignedClasses as string[] | undefined) ?? [];
}

/** Marks-entry rows for the given exam, scoped to `classKeys` (all classes if omitted). */
async function marksOverviewRows(schoolId: string, examId: string, classKeys?: Set<string>) {
  const exam = await ExamModel.findOne({ _id: examId, schoolId }).lean();
  if (!exam) throw ApiError.notFound('Exam not found');
  const examClasses = new Set((exam.classes ?? []) as string[]);
  const assignments = await TeacherClassModel.find({ schoolId }).lean();
  const teacherIds = [...new Set(assignments.map((a) => String(a.teacherUserId)))];
  const teachers = await UserModel.find({ _id: { $in: teacherIds } }).lean();
  const nameById = new Map(teachers.map((t) => [String(t._id), t.name as string]));
  const marks = await ExamMarkModel.find({ examId }).lean();

  const rows: Array<Record<string, unknown>> = [];
  for (const a of assignments) {
    if (!examClasses.has(a.className as string)) continue;
    const classKey = keyOf(a.className as string, a.section as string);
    if (classKeys && !classKeys.has(classKey)) continue;
    for (const subject of (a.subjects ?? []) as string[]) {
      const forCell = marks.filter((m) => m.classKey === (a.className as string));
      const status = forCell.length === 0 ? 'not_started' : forCell.every((m) => m.submitted) ? 'submitted' : 'in_progress';
      rows.push({
        id: `${examId}:${a.className}-${a.section}:${subject}`,
        classKey: `${a.className}-${a.section}`,
        className: a.className,
        section: a.section,
        subject,
        teacherName: nameById.get(String(a.teacherUserId)) ?? 'Unassigned',
        status,
      });
    }
  }
  return rows;
}

function dto(d: Doc): Record<string, unknown> {
  const { _id, __v, schoolId, createdAt, updatedAt, ...rest } = d as Record<string, unknown>;
  void __v;
  void schoolId;
  void createdAt;
  void updatedAt;
  return { id: String(_id), ...rest };
}

async function decide(schoolId: string, id: string, patch: Record<string, unknown>) {
  const doc = await StudentLeaveModel.findOneAndUpdate(
    { _id: id, schoolId },
    { $set: { ...patch, decidedAt: nowIso() } },
    { new: true },
  );
  if (!doc) throw ApiError.notFound('Leave request not found');
  return dto(doc.toObject());
}

export const coordinatorService = {
  async dashboard(schoolId: string, userId: string) {
    const assignedClasses = await assignedClassesOf(userId);
    const supervisedClassSet = new Set(assignedClasses);
    const todayStr = nowIso().slice(0, 10);

    const [classes, sections, exams, leaves, todaysAttendance, pendingStaffLeaves] = await Promise.all([
      ClassModel.countDocuments({ schoolId }),
      SectionModel.countDocuments({ schoolId }),
      ExamModel.find({ schoolId }).lean(),
      StudentLeaveModel.find({ schoolId }).sort({ appliedOn: -1 }).lean(),
      AttendanceModel.aggregate<{ _id: string; total: number; present: number }>([
        { $match: { schoolId, date: todayStr, ...(assignedClasses.length ? { className: { $in: [...supervisedClassSet].map((k) => k.split('-')[0]) } } : {}) } },
        {
          $group: {
            _id: { $concat: ['$className', '-', '$section'] },
            total: { $sum: 1 },
            present: { $sum: { $cond: [{ $in: ['$status', ['present', 'late', 'half_day']] }, 1, 0] } },
          },
        },
      ]),
      StaffLeaveModel.countDocuments({ schoolId, currentLevel: 1, status: 'pending' }),
    ]);

    const scheduled = exams
      .filter((e) => e.status === 'scheduled')
      .sort((a, b) => ((a.startDate ?? '') < (b.startDate ?? '') ? -1 : 1));
    const nextExam = scheduled[0];

    // The $match above only pre-filters by className (cheap index hit); narrow to
    // the exact supervised classKeys here since a className can span sections
    // the coordinator doesn't supervise (e.g. supervises "V-A" but not "V-B").
    const scopedAttendance = assignedClasses.length
      ? todaysAttendance.filter((r) => supervisedClassSet.has(r._id))
      : todaysAttendance;
    const markedClassKeys = new Set(scopedAttendance.map((r) => r._id));
    const relevantClassKeys = assignedClasses.length ? assignedClasses : [...markedClassKeys];
    const classesNotMarkedYet = relevantClassKeys.filter((k) => !markedClassKeys.has(k)).length;
    const totalStudentsToday = scopedAttendance.reduce((sum, r) => sum + r.total, 0);
    const presentToday = scopedAttendance.reduce((sum, r) => sum + r.present, 0);
    const attendanceTodayPercent = totalStudentsToday ? Math.round((presentToday / totalStudentsToday) * 100) : 0;

    let pendingMarksCount = 0;
    if (nextExam) {
      const rows = await marksOverviewRows(schoolId, String(nextExam._id), supervisedClassSet.size ? supervisedClassSet : undefined).catch(() => []);
      pendingMarksCount = rows.filter((r) => r.status !== 'submitted').length;
    }

    type Category = 'attendance' | 'leave' | 'marks' | 'timetable' | 'exam';
    const pendingTasks: Array<{ id: string; description: string; category: Category; priority: number; href: string }> = [];
    if (classesNotMarkedYet > 0) {
      pendingTasks.push({
        id: 'attendance-pending',
        description: `${classesNotMarkedYet} class${classesNotMarkedYet > 1 ? 'es' : ''} yet to mark attendance today`,
        category: 'attendance',
        priority: 3,
        href: '/coordinator/attendance',
      });
    }
    if (pendingStaffLeaves > 0) {
      pendingTasks.push({
        id: 'staff-leaves-pending',
        description: `${pendingStaffLeaves} staff leave request${pendingStaffLeaves > 1 ? 's' : ''} awaiting your approval`,
        category: 'leave',
        priority: 2,
        href: '/coordinator/staff/leave-approvals',
      });
    }
    if (pendingMarksCount > 0) {
      pendingTasks.push({
        id: 'marks-pending',
        description: `${pendingMarksCount} marks entr${pendingMarksCount > 1 ? 'ies' : 'y'} not yet submitted for ${nextExam?.name ?? 'the upcoming exam'}`,
        category: 'marks',
        priority: 2,
        href: '/coordinator/examinations/marks-overview',
      });
    }
    const pendingStudentLeaves = leaves.filter((l) => l.status === 'pending').length;
    if (pendingStudentLeaves > 0) {
      pendingTasks.push({
        id: 'student-leaves-pending',
        description: `${pendingStudentLeaves} student leave request${pendingStudentLeaves > 1 ? 's' : ''} pending review`,
        category: 'leave',
        priority: 1,
        href: '/coordinator/students/leaves',
      });
    }
    pendingTasks.sort((a, b) => b.priority - a.priority);

    return {
      supervisedClassesCount: classes,
      supervisedSectionsCount: sections,
      attendanceTodayPercent,
      classesNotMarkedYet,
      pendingStaffLeaves,
      upcomingExamsCount: scheduled.length,
      nextExamName: nextExam?.name,
      nextExamDate: nextExam?.startDate,
      pendingMarksCount,
      acrossExamsCount: exams.length,
      pendingTasks,
      recentStudentLeaves: leaves.slice(0, 5).map((l) => ({
        id: String(l._id),
        studentName: l.studentName,
        className: l.className,
        type: l.type,
        days: l.days,
        status: l.status,
        appliedOn: l.appliedOn,
      })),
    };
  },

  async getStudents(schoolId: string, userId: string, filter: { classKey?: string; search?: string; profileStatus?: string }) {
    const assignedClasses = await assignedClassesOf(userId);
    const supervisedKeys = new Set(assignedClasses);
    const studentFilter: Record<string, unknown> = { schoolId };
    if (filter.profileStatus && filter.profileStatus !== 'all') studentFilter.profileStatus = filter.profileStatus;
    const students = (await StudentModel.find(studentFilter).lean()).filter(
      (s) => supervisedKeys.size === 0 || supervisedKeys.has(keyOf((s.className as string) ?? '', (s.section as string) ?? '')),
    );
    const ids = students.map((s) => s._id);
    const attendance = await AttendanceModel.find({ schoolId, studentId: { $in: ids } }).lean();
    const stats = new Map<string, { total: number; present: number }>();
    for (const r of attendance) {
      const k = String(r.studentId);
      const cur = stats.get(k) ?? { total: 0, present: 0 };
      cur.total += 1;
      if (r.status === 'present') cur.present += 1;
      stats.set(k, cur);
    }

    let rows = students.map((s) => {
      const st = stats.get(String(s._id));
      return {
        id: String(s._id),
        admissionNumber: (s.admissionNumber as string) ?? '',
        name: s.name,
        fatherName: (s.fatherName as string) ?? '',
        className: (s.className as string) ?? '',
        section: (s.section as string) ?? '',
        mobile: (s.mobile as string) ?? '',
        photoUrl: (s.photoUrl as string) ?? '',
        feeStatus: s.feeStatus,
        profileStatus: s.profileStatus,
        attendancePercent: st && st.total ? Math.round((st.present / st.total) * 100) : 100,
      };
    });
    if (filter.classKey && filter.classKey !== 'all') rows = rows.filter((r) => keyOf(r.className, r.section) === filter.classKey);
    if (filter.search?.trim()) {
      const q = filter.search.trim().toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.admissionNumber.toLowerCase().includes(q));
    }
    return rows;
  },

  async setAssignedClasses(schoolId: string, coordinatorUserId: string, classKeys: string[]) {
    const user = await UserModel.findOneAndUpdate(
      { _id: coordinatorUserId, schoolId, role: 'coordinator' },
      { $set: { assignedClasses: classKeys } },
      { new: true },
    ).lean();
    if (!user) throw ApiError.notFound('Coordinator not found');
    return { id: String(user._id), assignedClasses: user.assignedClasses ?? [] };
  },

  // ─── Teacher → class assignments (drives the teacher portal's "My Classes"/"My Students") ───
  async getTeachers(schoolId: string) {
    const teachers = await UserModel.find({ schoolId, role: 'teacher' }).select('name mobile email').lean();
    return teachers.map((t) => ({ id: String(t._id), name: t.name, mobile: t.mobile, email: t.email }));
  },

  async getTeacherAssignments(schoolId: string, teacherUserId?: string) {
    const filter: Record<string, unknown> = { schoolId };
    if (teacherUserId) filter.teacherUserId = teacherUserId;
    const [assignments, teachers] = await Promise.all([
      TeacherClassModel.find(filter).sort({ className: 1, section: 1 }).lean(),
      UserModel.find({ schoolId, role: 'teacher' }).select('name').lean(),
    ]);
    const nameById = new Map(teachers.map((t) => [String(t._id), t.name as string]));
    return assignments.map((a) => ({
      id: String(a._id),
      teacherUserId: String(a.teacherUserId),
      teacherName: nameById.get(String(a.teacherUserId)) ?? 'Unknown',
      className: a.className ?? '',
      section: a.section ?? '',
      classKey: keyOf((a.className as string) ?? '', (a.section as string) ?? ''),
      subjects: a.subjects ?? [],
      periodsPerWeek: a.periodsPerWeek ?? 0,
    }));
  },

  async saveTeacherAssignment(
    schoolId: string,
    payload: { teacherUserId: string; className: string; section: string; subjects: string[]; periodsPerWeek: number },
  ) {
    const teacher = await UserModel.findOne({ _id: payload.teacherUserId, schoolId, role: 'teacher' }).lean();
    if (!teacher) throw ApiError.notFound('Teacher not found');
    const doc = await TeacherClassModel.findOneAndUpdate(
      { schoolId, teacherUserId: payload.teacherUserId, className: payload.className, section: payload.section },
      { $set: { subjects: payload.subjects, periodsPerWeek: payload.periodsPerWeek } },
      { new: true, upsert: true },
    ).lean();
    return {
      id: String(doc!._id),
      teacherUserId: String(doc!.teacherUserId),
      teacherName: teacher.name as string,
      className: doc!.className ?? '',
      section: doc!.section ?? '',
      classKey: keyOf((doc!.className as string) ?? '', (doc!.section as string) ?? ''),
      subjects: doc!.subjects ?? [],
      periodsPerWeek: doc!.periodsPerWeek ?? 0,
    };
  },

  async deleteTeacherAssignment(schoolId: string, id: string) {
    const doc = await TeacherClassModel.findOneAndDelete({ _id: id, schoolId });
    if (!doc) throw ApiError.notFound('Assignment not found');
  },

  async getStudentLeaves(schoolId: string, q: Record<string, string>) {
    const filter: Record<string, unknown> = { schoolId };
    if (q.status && q.status !== 'all') filter.status = q.status;
    return (await StudentLeaveModel.find(filter).sort({ appliedOn: -1 }).lean()).map(dto);
  },

  async applyOnBehalf(schoolId: string, payload: Record<string, unknown>) {
    const { id, ...fields } = payload;
    void id;
    const doc = await StudentLeaveModel.create({
      schoolId,
      ...fields,
      appliedOn: nowIso(),
      status: 'approved',
      decidedBy: 'Coordinator (on behalf)',
      decidedAt: nowIso(),
    });
    return dto(doc.toObject());
  },

  approve(schoolId: string, id: string, remarks?: string) {
    return decide(schoolId, id, { status: 'approved', remarks, decidedBy: 'Coordinator' });
  },
  reject(schoolId: string, id: string, reason: string) {
    return decide(schoolId, id, { status: 'rejected', rejectionReason: reason, decidedBy: 'Coordinator' });
  },
  forward(schoolId: string, id: string, remarks?: string) {
    return decide(schoolId, id, { status: 'forwarded', remarks, decidedBy: 'Coordinator → Principal' });
  },

  // ─── Staff leaves (Level-1 coordinator queue) ───
  async getStaffLeaves(schoolId: string, tab?: string) {
    const filter: Record<string, unknown> =
      tab === 'history'
        ? { schoolId, $or: [{ status: { $ne: 'pending' } }, { currentLevel: { $gt: 1 } }] }
        : { schoolId, currentLevel: 1, status: 'pending' };
    return (await StaffLeaveModel.find(filter).sort({ appliedOn: -1 }).lean()).map(dto);
  },

  async approveStaffLeaveLevel1(schoolId: string, id: string, remarks?: string) {
    // L1 approval moves the request up to the Principal (Level 2); it stays pending.
    const doc = await StaffLeaveModel.findOneAndUpdate(
      { _id: id, schoolId },
      { $set: { currentLevel: 2, remarks, decidedAt: nowIso() } },
      { new: true },
    );
    if (!doc) throw ApiError.notFound('Staff leave not found');
    return dto(doc.toObject());
  },

  async rejectStaffLeave(schoolId: string, id: string, reason: string) {
    const doc = await StaffLeaveModel.findOneAndUpdate(
      { _id: id, schoolId },
      { $set: { status: 'rejected', rejectionReason: reason, decidedAt: nowIso() } },
      { new: true },
    );
    if (!doc) throw ApiError.notFound('Staff leave not found');
    return dto(doc.toObject());
  },

  // ─── Marks-entry overview for an exam ───
  getMarksOverview(schoolId: string, examId: string) {
    return marksOverviewRows(schoolId, examId);
  },

  // ─── Staff overview + attendance (today) ───
  async getStaffOverview(schoolId: string, department?: string) {
    const filter: Record<string, unknown> = { schoolId };
    if (department && department !== 'all') filter.department = department;
    const [staff, todays] = await Promise.all([
      StaffModel.find(filter).lean(),
      StaffAttendanceModel.find({ schoolId, date: today() }).lean(),
    ]);
    const byStaff = new Map(todays.map((a) => [String(a.staffId), a]));
    return staff.map((s) => {
      const att = byStaff.get(String(s._id));
      return {
        id: String(s._id),
        name: s.name,
        designation: (s.designationLabel as string) || (s.designation as string) || '',
        department: (s.departmentLabel as string) || (s.department as string) || '',
        mobile: (s.mobile as string) ?? '',
        todayStatus: att ? mapStaffStatus(att.status as string) : 'not_marked',
      };
    });
  },

  async getStaffAttendance(schoolId: string, department?: string) {
    const filter: Record<string, unknown> = { schoolId };
    if (department && department !== 'all') filter.department = department;
    const [staff, todays] = await Promise.all([
      StaffModel.find(filter).lean(),
      StaffAttendanceModel.find({ schoolId, date: today() }).lean(),
    ]);
    const byStaff = new Map(todays.map((a) => [String(a.staffId), a]));
    return staff.map((s) => {
      const att = byStaff.get(String(s._id));
      return {
        id: String(s._id),
        name: s.name,
        designation: (s.designationLabel as string) || (s.designation as string) || '',
        department: (s.departmentLabel as string) || (s.department as string) || '',
        status: att ? mapStaffStatus(att.status as string) : 'not_marked',
        timeIn: att?.timeIn as string | undefined,
        timeOut: att?.timeOut as string | undefined,
        remarks: att?.remarks as string | undefined,
      };
    });
  },

  async exportStudentsReport(schoolId: string, userId: string, filter: { classKey?: string; search?: string }): Promise<ReportData> {
    const rows = await coordinatorService.getStudents(schoolId, userId, filter);
    return {
      title: 'Students',
      subtitle: 'Students in the coordinator\'s supervised classes.',
      columns: ['Admission No', 'Name', 'Father Name', 'Class', 'Section', 'Mobile', 'Attendance %', 'Fee Status'],
      rows: rows.map((r) => [r.admissionNumber, r.name, r.fatherName, r.className, r.section, r.mobile, r.attendancePercent, String(r.feeStatus)]),
    };
  },

  async exportStaffAttendanceReport(schoolId: string, department?: string): Promise<ReportData> {
    const rows = await coordinatorService.getStaffAttendance(schoolId, department);
    return {
      title: 'Staff Attendance',
      subtitle: `Today's staff attendance (${today()}).`,
      columns: ['Name', 'Designation', 'Department', 'Status', 'Time In', 'Time Out', 'Remarks'],
      rows: rows.map((r) => [r.name, r.designation, r.department, r.status, r.timeIn ?? '', r.timeOut ?? '', r.remarks ?? '']),
    };
  },

  async messageStaff(schoolId: string, staffId: string, body: string) {
    const staff = await StaffModel.findOne({ _id: staffId, schoolId }).lean();
    if (!staff) throw ApiError.notFound('Staff member not found');
    const mobile = (staff.mobile as string) ?? '';
    if (!mobile) throw ApiError.badRequest('This staff member has no mobile number on file');
    const [result] = await sendBulk([{ id: String(staff._id), name: staff.name as string, mobile }], 'sms', body);
    const doc = await MessageHistoryModel.create({
      schoolId,
      channel: 'sms',
      recipientCount: 1,
      delivered: result.status === 'delivered' ? 1 : 0,
      failed: result.status === 'failed' ? 1 : 0,
      body,
      status: result.status === 'delivered' ? 'sent' : 'failed',
      deliveryReport: [result],
    });
    return { id: String(doc._id), status: result.status, recipientName: result.recipientName };
  },
};

const today = (): string => nowIso().slice(0, 10);
function mapStaffStatus(s: string): string {
  if (s === 'leave') return 'on_leave';
  if (s === 'present' || s === 'late' || s === 'half_day') return 'present';
  if (s === 'absent') return 'absent';
  return 'not_marked';
}
