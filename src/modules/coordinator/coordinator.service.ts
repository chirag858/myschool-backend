import { ClassModel, SectionModel } from '../academics/academics.models';
import { ApiError } from '../../lib/api-error';
import { ExamMarkModel, ExamModel } from '../exams/exams.models';
import { StaffAttendanceModel, StaffModel } from '../staff/staff.models';
import { TeacherClassModel } from '../teacher/teacher.models';
import { UserModel } from '../user/user.model';
import { StaffLeaveModel, StudentLeaveModel } from './coordinator.models';

type Doc = Record<string, unknown> & { _id: unknown };
const nowIso = (): string => new Date().toISOString();

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
  async dashboard(schoolId: string) {
    const [classes, sections, exams, leaves] = await Promise.all([
      ClassModel.countDocuments({ schoolId }),
      SectionModel.countDocuments({ schoolId }),
      ExamModel.find({ schoolId }).lean(),
      StudentLeaveModel.find({ schoolId }).sort({ appliedOn: -1 }).lean(),
    ]);
    const scheduled = exams
      .filter((e) => e.status === 'scheduled')
      .sort((a, b) => ((a.startDate ?? '') < (b.startDate ?? '') ? -1 : 1));
    return {
      supervisedClassesCount: classes,
      supervisedSectionsCount: sections,
      attendanceTodayPercent: 0,
      classesNotMarkedYet: 0,
      pendingStaffLeaves: 0,
      upcomingExamsCount: scheduled.length,
      nextExamName: scheduled[0]?.name,
      nextExamDate: scheduled[0]?.startDate,
      pendingMarksCount: 0,
      acrossExamsCount: exams.length,
      pendingTasks: [],
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
  async getMarksOverview(schoolId: string, examId: string) {
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
};

const today = (): string => nowIso().slice(0, 10);
function mapStaffStatus(s: string): string {
  if (s === 'leave') return 'on_leave';
  if (s === 'present' || s === 'late' || s === 'half_day') return 'present';
  if (s === 'absent') return 'absent';
  return 'not_marked';
}
