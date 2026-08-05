import { Types } from 'mongoose';

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
import { timetableService } from '../timetable/timetable.service';
import { UserModel } from '../user/user.model';
import { StaffLeaveModel, StudentLeaveModel } from './coordinator.models';

type Doc = Record<string, unknown> & { _id: unknown };
const nowIso = (): string => new Date().toISOString();
const keyOf = (className: string, section: string): string => `${className}-${section}`;

async function assignedClassesOf(userId: string): Promise<string[]> {
  const user = await UserModel.findById(userId).lean();
  return (user?.assignedClasses as string[] | undefined) ?? [];
}

/** Student-leave rows store `className` as whatever was on the student at apply
 * time — sometimes just the bare class name, no section — so it can't be trusted
 * to match a classKey filter directly. Resolve each row's real classKey from the
 * student record itself (the source of truth) and scope by that instead. */
async function scopeLeavesToSupervised<T extends { studentId?: unknown; className?: unknown }>(
  leaves: T[],
  supervisedKeys: Set<string>,
): Promise<T[]> {
  if (!supervisedKeys.size) return leaves;
  const studentIds = leaves.map((l) => l.studentId).filter(Boolean);
  const students = await StudentModel.find({ _id: { $in: studentIds } }).lean();
  const classKeyById = new Map(
    students.map((s) => [String(s._id), keyOf((s.className as string) ?? '', (s.section as string) ?? '')]),
  );
  return leaves.filter((l) => supervisedKeys.has(classKeyById.get(String(l.studentId)) ?? (l.className as string) ?? ''));
}

/** Every real "ClassName-Section" combo for the school, per the classKey convention
 * used across students/exams/timetable — assigned-classes must stay a subset of this. */
async function validClassKeys(schoolId: string): Promise<Set<string>> {
  const classes = await ClassModel.find({ schoolId }).lean();
  const sections = await SectionModel.find({ schoolId }).lean();
  const classNameById = new Map(classes.map((c) => [String(c._id), c.name as string]));
  return new Set(
    sections
      .map((s) => {
        const className = classNameById.get(String(s.classId));
        return className ? keyOf(className, s.name as string) : null;
      })
      .filter((key): key is string => Boolean(key)),
  );
}

/** Marks-entry rows for the given exam, scoped to `classKeys` (all classes if omitted).
 * Who-teaches-what comes from the real timetable (`timetableService.getAllTeachingAssignments`)
 * rather than a separately hand-maintained assignment list, so it can never drift out of sync
 * with what's actually scheduled. */
async function marksOverviewRows(schoolId: string, examId: string, classKeys?: Set<string>) {
  const exam = await ExamModel.findOne({ _id: examId, schoolId }).lean();
  if (!exam) throw ApiError.notFound('Exam not found');
  const examClasses = (exam.classes ?? []) as string[];
  const assignments = await timetableService.getAllTeachingAssignments(schoolId);
  const teacherIds = [...new Set(assignments.map((a) => a.teacherUserId))];
  const teachers = await UserModel.find({ _id: { $in: teacherIds } }).lean();
  const nameById = new Map(teachers.map((t) => [String(t._id), t.name as string]));
  const marks = await ExamMarkModel.find({ examId }).lean();

  const rows: Array<Record<string, unknown>> = [];
  for (const a of assignments) {
    // Exams store `classes` as either a bare class name ("Class 1") or a
    // full classKey with section ("Class 1-A") — match either form.
    const classKey = keyOf(a.className, a.section);
    if (!examClasses.includes(a.className) && !examClasses.includes(classKey)) continue;
    if (classKeys && !classKeys.has(classKey)) continue;
    for (const subject of a.subjects) {
      const forCell = marks.filter((m) => m.classKey === a.className || m.classKey === classKey);
      const status = forCell.length === 0 ? 'not_started' : forCell.every((m) => m.submitted) ? 'submitted' : 'in_progress';
      rows.push({
        id: `${examId}:${classKey}:${subject}`,
        classKey,
        className: a.className,
        section: a.section,
        subject,
        teacherName: nameById.get(a.teacherUserId) ?? 'Unassigned',
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

async function decide(schoolId: string, userId: string, id: string, patch: Record<string, unknown>) {
  // Mirror the read-path scoping (scopeLeavesToSupervised): a coordinator with a
  // real assignedClasses list may only decide leaves for students in that scope,
  // even if they know/guess the leave's id.
  const supervisedKeys = new Set(await assignedClassesOf(userId));
  if (supervisedKeys.size) {
    const leave = await StudentLeaveModel.findOne({ _id: id, schoolId }).lean();
    if (!leave) throw ApiError.notFound('Leave request not found');
    const [inScope] = await scopeLeavesToSupervised([leave], supervisedKeys);
    if (!inScope) throw ApiError.notFound('Leave request not found');
  }
  // `status: 'pending'` in the filter makes this an atomic check-and-update —
  // a leave that's already been decided can't be re-approved/re-rejected/re-forwarded
  // by a retry, double-click, or a second reviewer racing the first.
  const doc = await StudentLeaveModel.findOneAndUpdate(
    { _id: id, schoolId, status: 'pending' },
    { $set: { ...patch, decidedAt: nowIso() } },
    { new: true },
  );
  if (!doc) {
    const exists = await StudentLeaveModel.exists({ _id: id, schoolId });
    throw exists ? ApiError.conflict('This leave request has already been decided') : ApiError.notFound('Leave request not found');
  }
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
        {
          $match: {
            // .aggregate() doesn't auto-cast filter values like .find() does —
            // schoolId must be cast to ObjectId or this stage matches nothing.
            schoolId: new Types.ObjectId(schoolId),
            date: todayStr,
            ...(assignedClasses.length ? { className: { $in: [...supervisedClassSet].map((k) => k.split('-')[0]) } } : {}),
          },
        },
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
    // Same scoping as everywhere else: a real assignedClasses list narrows to that
    // subset; an unscoped coordinator (empty array) still sees every leave request.
    const scopedLeaves = await scopeLeavesToSupervised(leaves, supervisedClassSet);

    const scheduled = exams
      .filter((e) => e.status === 'scheduled')
      .sort((a, b) => ((a.startDate ?? '') < (b.startDate ?? '') ? -1 : 1));
    const nextExam = scheduled[0];

    // A coordinator with a real assignedClasses scope supervises exactly that
    // subset, not the whole school — an unscoped coordinator (empty array) still
    // sees everything, matching the convention used everywhere else in this file.
    const supervisedClassesCount = assignedClasses.length
      ? new Set(assignedClasses.map((k) => k.split('-')[0])).size
      : classes;
    const supervisedSectionsCount = assignedClasses.length ? assignedClasses.length : sections;

    // The $match above only pre-filters by className (cheap index hit); narrow to
    // the exact supervised classKeys here since a className can span sections
    // the coordinator doesn't supervise (e.g. supervises "V-A" but not "V-B").
    const scopedAttendance = assignedClasses.length
      ? todaysAttendance.filter((r) => supervisedClassSet.has(r._id))
      : todaysAttendance;
    const markedClassKeys = new Set(scopedAttendance.map((r) => r._id));
    // BUG FIXED: this used to fall back to `[...markedClassKeys]` for an unscoped
    // coordinator — filtering the marked set against itself, so classesNotMarkedYet
    // was always 0 no matter how many classes were actually unmarked. Use every
    // real classKey in the school instead.
    const relevantClassKeys = assignedClasses.length ? assignedClasses : [...(await validClassKeys(schoolId))];
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
    const pendingStudentLeaves = scopedLeaves.filter((l) => l.status === 'pending').length;
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
      supervisedClassesCount,
      supervisedSectionsCount,
      attendanceTodayPercent,
      classesNotMarkedYet,
      pendingStaffLeaves,
      upcomingExamsCount: scheduled.length,
      nextExamName: nextExam?.name,
      nextExamDate: nextExam?.startDate,
      pendingMarksCount,
      acrossExamsCount: exams.length,
      pendingTasks,
      recentStudentLeaves: scopedLeaves.slice(0, 5).map((l) => ({
        id: String(l._id),
        studentName: l.studentName,
        className: l.className,
        type: l.type,
        days: l.days,
        status: l.status,
        appliedOn: l.appliedOn,
        fromDate: l.fromDate,
        toDate: l.toDate,
        reason: l.reason,
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

  async setAssignedClasses(schoolId: string, targetUserId: string, classKeys: string[]) {
    const target = await UserModel.findOne({ _id: targetUserId, schoolId }).lean();
    if (!target) throw ApiError.notFound('Staff member not found');
    if (target.role === 'teacher') throw ApiError.badRequest('Teachers use class-incharge assignment, not assigned classes');

    if (classKeys.length) {
      const validKeys = await validClassKeys(schoolId);
      const unknown = classKeys.filter((k) => !validKeys.has(k));
      if (unknown.length) throw ApiError.badRequest(`Unknown class/section: ${unknown.join(', ')}`);
    }

    const user = await UserModel.findOneAndUpdate(
      { _id: targetUserId, schoolId },
      { $set: { assignedClasses: classKeys } },
      { new: true },
    ).lean();
    if (!user) throw ApiError.notFound('Staff member not found');
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

  async getStudentLeaves(schoolId: string, userId: string, q: Record<string, string>) {
    const supervisedKeys = new Set(await assignedClassesOf(userId));
    const filter: Record<string, unknown> = { schoolId };
    if (q.status && q.status !== 'all') filter.status = q.status;
    const leaves = await StudentLeaveModel.find(filter).sort({ appliedOn: -1 }).lean();
    const scoped = await scopeLeavesToSupervised(leaves, supervisedKeys);
    return scoped.map(dto);
  },

  async applyOnBehalf(schoolId: string, payload: Record<string, unknown>) {
    // Never trust client-supplied schoolId/status/decidedBy/decidedAt — spread
    // `fields` first so these explicit, server-owned values always win.
    const { id, schoolId: _schoolId, status, decidedBy, decidedAt, appliedOn, ...fields } = payload;
    void id;
    void _schoolId;
    void status;
    void decidedBy;
    void decidedAt;
    void appliedOn;
    const doc = await StudentLeaveModel.create({
      ...fields,
      schoolId,
      appliedOn: nowIso(),
      status: 'approved',
      decidedBy: 'Coordinator (on behalf)',
      decidedAt: nowIso(),
    });
    return dto(doc.toObject());
  },

  approve(schoolId: string, userId: string, id: string, remarks?: string) {
    return decide(schoolId, userId, id, { status: 'approved', remarks, decidedBy: 'Coordinator' });
  },
  reject(schoolId: string, userId: string, id: string, reason: string) {
    return decide(schoolId, userId, id, { status: 'rejected', rejectionReason: reason, decidedBy: 'Coordinator' });
  },
  forward(schoolId: string, userId: string, id: string, remarks?: string) {
    return decide(schoolId, userId, id, { status: 'forwarded', remarks, decidedBy: 'Coordinator → Principal' });
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
    // Filtering on currentLevel: 1 + status: 'pending' makes this an atomic
    // check-and-update — a leave already escalated/decided can't be re-approved.
    const doc = await StaffLeaveModel.findOneAndUpdate(
      { _id: id, schoolId, currentLevel: 1, status: 'pending' },
      { $set: { currentLevel: 2, remarks, decidedAt: nowIso() } },
      { new: true },
    );
    if (!doc) {
      const exists = await StaffLeaveModel.exists({ _id: id, schoolId });
      throw exists ? ApiError.conflict('This staff leave has already been decided') : ApiError.notFound('Staff leave not found');
    }
    return dto(doc.toObject());
  },

  async rejectStaffLeave(schoolId: string, id: string, reason: string) {
    const doc = await StaffLeaveModel.findOneAndUpdate(
      { _id: id, schoolId, status: 'pending' },
      { $set: { status: 'rejected', rejectionReason: reason, decidedAt: nowIso() } },
      { new: true },
    );
    if (!doc) {
      const exists = await StaffLeaveModel.exists({ _id: id, schoolId });
      throw exists ? ApiError.conflict('This staff leave has already been decided') : ApiError.notFound('Staff leave not found');
    }
    return dto(doc.toObject());
  },

  // ─── Marks-entry overview for an exam ───
  async getMarksOverview(schoolId: string, userId: string, examId: string) {
    const supervisedKeys = new Set(await assignedClassesOf(userId));
    return marksOverviewRows(schoolId, examId, supervisedKeys.size ? supervisedKeys : undefined);
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

  async getStaffAttendance(schoolId: string, department?: string, date?: string) {
    const filter: Record<string, unknown> = { schoolId };
    if (department && department !== 'all') filter.department = department;
    const [staff, todays] = await Promise.all([
      StaffModel.find(filter).lean(),
      StaffAttendanceModel.find({ schoolId, date: date ?? today() }).lean(),
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

  async exportStudentsReport(schoolId: string, userId: string, filter: { classKey?: string; search?: string; profileStatus?: string }): Promise<ReportData> {
    const rows = await coordinatorService.getStudents(schoolId, userId, filter);
    return {
      title: 'Students',
      subtitle: 'Students in the coordinator\'s supervised classes.',
      columns: ['Admission No', 'Name', 'Father Name', 'Class', 'Section', 'Mobile', 'Attendance %', 'Fee Status'],
      rows: rows.map((r) => [r.admissionNumber, r.name, r.fatherName, r.className, r.section, r.mobile, r.attendancePercent, String(r.feeStatus)]),
    };
  },

  async exportStaffAttendanceReport(schoolId: string, department?: string, date?: string): Promise<ReportData> {
    const rows = await coordinatorService.getStaffAttendance(schoolId, department, date);
    return {
      title: 'Staff Attendance',
      subtitle: `Staff attendance for ${date ?? today()}.`,
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
