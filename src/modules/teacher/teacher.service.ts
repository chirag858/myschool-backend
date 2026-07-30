import { ApiError } from '../../lib/api-error';
import { AttendanceModel } from '../attendance/attendance.models';
import { CircularModel } from '../communication/communication.models';
import { ExamModel } from '../exams/exams.models';
import { StudentModel } from '../students/student.model';
import { UserModel } from '../user/user.model';
import {
  SubmissionModel,
  TeacherAssignmentModel,
  TeacherClassModel,
  TeacherHomeworkModel,
  TeacherLeaveModel,
} from './teacher.models';

type Doc = Record<string, unknown> & { _id: unknown };
const nowIso = (): string => new Date().toISOString();
const today = (): string => nowIso().slice(0, 10);
const LEAVE_ALLOTMENT: Record<string, number> = { casual: 12, sick: 10, earned: 15, special: 5 };

function dto(d: Doc): Record<string, unknown> {
  const { _id, __v, schoolId, teacherUserId, createdAt, updatedAt, ...rest } = d as Record<string, unknown>;
  void __v;
  void schoolId;
  void teacherUserId;
  void createdAt;
  void updatedAt;
  return { id: String(_id), ...rest };
}

async function teacherName(userId: string): Promise<string> {
  const u = await UserModel.findById(userId).lean();
  return (u?.name as string) ?? 'Teacher';
}
async function myAssignments(schoolId: string, userId: string) {
  return TeacherClassModel.find({ schoolId, teacherUserId: userId }).lean();
}
const keyOf = (className: string, section: string): string => `${className}-${section}`;

export const teacherService = {
  async getMyClasses(schoolId: string, userId: string) {
    const assignments = await myAssignments(schoolId, userId);
    return Promise.all(
      assignments.map(async (a) => {
        const [total, todays] = await Promise.all([
          StudentModel.countDocuments({ schoolId, className: a.className, section: a.section, profileStatus: 'active' }),
          AttendanceModel.find({ schoolId, className: a.className, section: a.section, date: today() }).lean(),
        ]);
        const present = todays.filter((r) => r.status === 'present').length;
        const absent = todays.filter((r) => r.status === 'absent').length;
        return {
          id: String(a._id),
          classKey: keyOf(a.className, a.section),
          className: a.className,
          section: a.section,
          subjects: a.subjects,
          totalStudents: total,
          periodsPerWeek: a.periodsPerWeek,
          attendanceToday: { status: todays.length ? 'marked' : 'pending', present, absent },
        };
      }),
    );
  },

  async getMyStudents(schoolId: string, userId: string, filter: { classKey?: string; search?: string }) {
    const assignments = await myAssignments(schoolId, userId);
    const myKeys = new Set(assignments.map((a) => keyOf(a.className, a.section)));
    const students = (await StudentModel.find({ schoolId, profileStatus: 'active' }).lean()).filter((s) =>
      myKeys.has(keyOf(s.className ?? '', s.section ?? '')),
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
        admissionNumber: s.admissionNumber ?? '',
        name: s.name,
        fatherName: s.fatherName ?? '',
        className: s.className ?? '',
        section: s.section ?? '',
        mobile: (s.mobile as string) ?? '',
        attendancePercent: st && st.total ? Math.round((st.present / st.total) * 100) : 100,
      };
    });
    if (filter.classKey && filter.classKey !== 'all') rows = rows.filter((r) => keyOf(r.className, r.section) === filter.classKey);
    if (filter.search) {
      const q = filter.search.toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.admissionNumber.toLowerCase().includes(q));
    }
    return rows;
  },

  async getDashboardSummary(schoolId: string, userId: string) {
    const [classes, exams, homework] = await Promise.all([
      this.getMyClasses(schoolId, userId),
      this.getMyExams(schoolId, userId),
      this.getHomework(schoolId, userId),
    ]);

    const attendancePending = classes.filter((c) => c.attendanceToday.status === 'pending');
    const marksPending = exams.filter((e) => e.marksEntryStatus !== 'submitted');
    const homeworkClassKeysToday = new Set(
      homework.filter((h) => h.assignedDate === today()).map((h) => h.classKey as string),
    );
    const homeworkGaps = classes.filter((c) => !homeworkClassKeysToday.has(c.classKey));

    const pendingTasks = [
      ...attendancePending.map((c) => ({
        key: `attendance:${c.classKey}`,
        type: 'attendance' as const,
        classKey: c.classKey,
      })),
      ...marksPending.map((e) => ({
        key: `marks:${e.id}`,
        type: 'marks' as const,
        classKey: e.classKey,
        subject: e.subject,
        examName: e.name,
      })),
      ...homeworkGaps.map((c) => ({
        key: `homework:${c.classKey}`,
        type: 'homework' as const,
        classKey: c.classKey,
      })),
    ];

    return {
      kpis: {
        classes: classes.length,
        attendancePending: attendancePending.length,
        homeworkPending: homeworkGaps.length,
        marksPending: marksPending.length,
      },
      classesToday: classes.map((c) => ({
        classKey: c.classKey,
        className: c.className,
        section: c.section,
        subjects: c.subjects,
        totalStudents: c.totalStudents,
        attendanceStatus: c.attendanceToday.status,
      })),
      pendingTasks,
    };
  },

  async getMyExams(schoolId: string, userId: string) {
    const assignments = await myAssignments(schoolId, userId);
    const myClassNames = new Set(assignments.map((a) => a.className));
    const exams = (await ExamModel.find({ schoolId }).lean()).filter((e) =>
      (e.classes ?? []).some((c) => myClassNames.has(c)),
    );
    const rows: Array<Record<string, unknown>> = [];
    for (const e of exams) {
      for (const a of assignments) {
        if (!(e.classes ?? []).includes(a.className)) continue;
        for (const subject of a.subjects) {
          rows.push({
            id: `${String(e._id)}:${keyOf(a.className, a.section)}:${subject}`,
            name: e.name,
            classKey: keyOf(a.className, a.section),
            subject,
            marksEntryStatus: e.status === 'published' ? 'submitted' : e.status === 'marks_entry' ? 'in_progress' : 'not_started',
          });
        }
      }
    }
    return rows;
  },

  // ─── Homework ───
  async getHomework(schoolId: string, userId: string) {
    return (await TeacherHomeworkModel.find({ schoolId, teacherUserId: userId }).sort({ assignedDate: -1 }).lean()).map(dto);
  },

  async getAllHomework(schoolId: string, filters: Record<string, string>) {
    const q: Record<string, unknown> = { schoolId };
    if (filters.type && filters.type !== 'all') q.homeworkType = filters.type;
    if (filters.classKey && filters.classKey !== 'all') q.classKey = filters.classKey;
    if (filters.subject && filters.subject !== 'all') q.subject = filters.subject;
    return (await TeacherHomeworkModel.find(q).sort({ assignedDate: -1 }).lean()).map(dto);
  },

  async createHomework(schoolId: string, userId: string, payload: Record<string, unknown>) {
    const { id, submissions, editHistory, createdBy, createdById, ...fields } = payload;
    void id;
    void submissions;
    void editHistory;
    void createdBy;
    void createdById;
    const name = await teacherName(userId);
    const doc = await TeacherHomeworkModel.create({
      schoolId,
      teacherUserId: userId,
      ...fields,
      assignedDate: (fields.assignedDate as string) || today(),
      submissions: 0,
      homeworkType: (fields.homeworkType as string) || 'daily',
      createdBy: name,
      createdById: userId,
      editHistory: [],
    });
    return dto(doc.toObject());
  },

  async updateHomework(schoolId: string, userId: string, id: string, patch: Record<string, unknown>, role: string) {
    const hw = await TeacherHomeworkModel.findOne({ _id: id, schoolId });
    if (!hw) throw ApiError.notFound('Homework not found');
    const name = await teacherName(userId);
    Object.assign(hw, patch, {
      lastEditedBy: name,
      lastEditedAt: nowIso(),
      editHistory: [...(hw.editHistory ?? []), { by: name, role, at: nowIso(), summary: Object.keys(patch).join(', ') }],
    });
    await hw.save();
    return dto(hw.toObject());
  },

  async deleteHomework(schoolId: string, userId: string, id: string) {
    const r = await TeacherHomeworkModel.deleteOne({ _id: id, schoolId, teacherUserId: userId });
    if (!r.deletedCount) throw ApiError.notFound('Homework not found');
  },

  async getHomeworkSubmissions(schoolId: string, id: string) {
    const hw = await TeacherHomeworkModel.findOne({ _id: id, schoolId }).lean();
    if (!hw) throw ApiError.notFound('Homework not found');
    const [className, section] = splitKey(hw.classKey as string);
    const students = await StudentModel.find({ schoolId, className, section, profileStatus: 'active' })
      .sort({ rollNumber: 1 })
      .lean();
    return students.map((s, i) => ({
      id: `${id}:${String(s._id)}`,
      homeworkId: id,
      studentId: String(s._id),
      studentName: s.name,
      rollNo: Number(s.rollNumber) || i + 1,
      status: 'pending',
    }));
  },

  // ─── Assignments ───
  async getAssignments(schoolId: string, userId: string, filter: { classKey?: string; status?: string }) {
    const q: Record<string, unknown> = { schoolId, teacherUserId: userId };
    if (filter.classKey && filter.classKey !== 'all') q.classKey = filter.classKey;
    if (filter.status && filter.status !== 'all') q.status = filter.status;
    const rows = await TeacherAssignmentModel.find(q).sort({ assignedDate: -1 }).lean();
    return Promise.all(rows.map((a) => this.assignmentView(schoolId, a)));
  },

  async assignmentView(schoolId: string, a: Doc) {
    const [className, section] = splitKey(a.classKey as string);
    const [total, submitted] = await Promise.all([
      StudentModel.countDocuments({ schoolId, className, section, profileStatus: 'active' }),
      SubmissionModel.countDocuments({ schoolId, assignmentId: String(a._id), status: { $in: ['submitted', 'late', 'graded'] } }),
    ]);
    return {
      ...dto(a),
      totalStudents: total,
      submitted,
      pending: Math.max(total - submitted, 0),
    };
  },

  async createAssignment(schoolId: string, userId: string, payload: Record<string, unknown>) {
    const { id, totalStudents, submitted, pending, ...fields } = payload;
    void id;
    void totalStudents;
    void submitted;
    void pending;
    const doc = await TeacherAssignmentModel.create({
      schoolId,
      teacherUserId: userId,
      ...fields,
      assignedDate: (fields.assignedDate as string) || today(),
      status: (fields.status as string) || 'active',
    });
    return this.assignmentView(schoolId, doc.toObject() as Doc);
  },

  async closeAssignment(schoolId: string, userId: string, id: string) {
    const doc = await TeacherAssignmentModel.findOneAndUpdate(
      { _id: id, schoolId, teacherUserId: userId },
      { $set: { status: 'closed' } },
      { new: true },
    );
    if (!doc) throw ApiError.notFound('Assignment not found');
    return this.assignmentView(schoolId, doc.toObject() as Doc);
  },

  async deleteAssignment(schoolId: string, userId: string, id: string) {
    const r = await TeacherAssignmentModel.deleteOne({ _id: id, schoolId, teacherUserId: userId });
    if (!r.deletedCount) throw ApiError.notFound('Assignment not found');
    await SubmissionModel.deleteMany({ schoolId, assignmentId: id });
  },

  async getSubmissions(schoolId: string, id: string) {
    const a = await TeacherAssignmentModel.findOne({ _id: id, schoolId }).lean();
    if (!a) throw ApiError.notFound('Assignment not found');
    let rows = await SubmissionModel.find({ schoolId, assignmentId: id }).lean();
    if (rows.length === 0) {
      // Lazily materialise one submission row per student in the class.
      const [className, section] = splitKey(a.classKey as string);
      const students = await StudentModel.find({ schoolId, className, section, profileStatus: 'active' }).sort({ rollNumber: 1 }).lean();
      await SubmissionModel.insertMany(
        students.map((s, i) => ({
          schoolId,
          assignmentId: id,
          studentId: String(s._id),
          studentName: s.name,
          className: `${className}-${section}`,
          // Alternate so the grading UI has both submitted and pending rows to work with.
          status: i % 3 === 2 ? 'pending' : 'submitted',
          submittedAt: i % 3 === 2 ? undefined : nowIso(),
          fileName: i % 3 === 2 ? undefined : `submission-${s.rollNumber || i + 1}.pdf`,
        })),
      );
      rows = await SubmissionModel.find({ schoolId, assignmentId: id }).lean();
    }
    return rows.map((r) => ({
      id: String(r._id),
      assignmentId: id,
      studentId: String(r.studentId),
      studentName: r.studentName,
      className: r.className,
      submittedAt: r.submittedAt,
      status: r.status,
      textContent: r.textContent,
      fileName: r.fileName,
      marks: r.marks ?? undefined,
      feedback: r.feedback ?? undefined,
    }));
  },

  async gradeSubmission(schoolId: string, id: string, studentId: string, payload: { marks: number; feedback: string }) {
    const doc = await SubmissionModel.findOneAndUpdate(
      { schoolId, assignmentId: id, studentId },
      { $set: { status: 'graded', marks: payload.marks, feedback: payload.feedback } },
      { new: true },
    );
    if (!doc) throw ApiError.notFound('Submission not found');
    const r = doc.toObject();
    return {
      id: String(r._id),
      assignmentId: id,
      studentId: String(r.studentId),
      studentName: r.studentName,
      className: r.className,
      status: r.status,
      marks: r.marks ?? undefined,
      feedback: r.feedback ?? undefined,
    };
  },

  // ─── Circulars (reuse the communication circulars store) ───
  async getReceivedCirculars(schoolId: string, userId: string) {
    const name = await teacherName(userId);
    const rows = await CircularModel.find({ schoolId, status: 'published', audience: { $in: ['all', 'staff', 'teacher'] } })
      .sort({ dateOfIssue: -1 })
      .lean();
    return rows.map((c) => circularView(c, name));
  },
  async getMyCirculars(schoolId: string, userId: string) {
    const name = await teacherName(userId);
    const rows = await CircularModel.find({ schoolId, createdBy: name }).sort({ dateOfIssue: -1 }).lean();
    return rows.map((c) => circularView(c, name));
  },
  async createCircular(schoolId: string, userId: string, payload: Record<string, unknown>) {
    const name = await teacherName(userId);
    const doc = await CircularModel.create({
      schoolId,
      number: (payload.number as string) || `TCIR/${Date.now()}`,
      title: payload.title,
      body: payload.body,
      dateOfIssue: (payload.dateOfIssue as string) || today(),
      audience: (payload.audience as string[]) || ['staff'],
      specificClasses: (payload.audienceClasses as string[]) || [],
      priority: (payload.priority as string) || 'normal',
      status: 'published',
      createdBy: name,
    });
    return circularView(doc.toObject(), name);
  },

  // ─── Leave ───
  async getLeaveBalance(schoolId: string, userId: string) {
    const approved = await TeacherLeaveModel.find({ schoolId, teacherUserId: userId, status: 'approved' }).lean();
    return Object.entries(LEAVE_ALLOTMENT).map(([type, allotted]) => {
      const used = approved.filter((l) => l.type === type).reduce((s, l) => s + Number(l.days ?? 0), 0);
      return { type, allotted, used, remaining: Math.max(allotted - used, 0) };
    });
  },
  async getLeaveHistory(schoolId: string, userId: string, filter: { type?: string; status?: string }) {
    const q: Record<string, unknown> = { schoolId, teacherUserId: userId };
    if (filter.type && filter.type !== 'all') q.type = filter.type;
    if (filter.status && filter.status !== 'all') q.status = filter.status;
    return (await TeacherLeaveModel.find(q).sort({ appliedOn: -1 }).lean()).map(dto);
  },
  async applyLeave(schoolId: string, userId: string, payload: Record<string, unknown>) {
    const count = await TeacherLeaveModel.countDocuments({ schoolId });
    const doc = await TeacherLeaveModel.create({
      schoolId,
      teacherUserId: userId,
      type: payload.type,
      fromDate: payload.fromDate,
      toDate: payload.toDate,
      reason: payload.reason,
      days: Number(payload.days ?? 1),
      substituteTeacher: payload.substituteTeacher,
      appliedOn: nowIso(),
      status: 'pending',
      referenceNumber: `LV-${String(count + 1).padStart(4, '0')}`,
    });
    return dto(doc.toObject());
  },
  async cancelLeave(schoolId: string, userId: string, id: string) {
    const doc = await TeacherLeaveModel.findOneAndUpdate(
      { _id: id, schoolId, teacherUserId: userId },
      { $set: { status: 'cancelled' } },
      { new: true },
    );
    if (!doc) throw ApiError.notFound('Leave not found');
    return dto(doc.toObject());
  },
};

function splitKey(classKey: string): [string, string] {
  const idx = classKey.lastIndexOf('-');
  if (idx === -1) return [classKey, ''];
  return [classKey.slice(0, idx), classKey.slice(idx + 1)];
}

function circularView(c: Doc, teacher: string): Record<string, unknown> {
  return {
    id: String(c._id),
    number: (c.number as string) ?? '',
    title: c.title,
    body: (c.body as string) ?? '',
    dateOfIssue: (c.dateOfIssue as string) ?? '',
    priority: (c.priority as string) ?? 'normal',
    audience: (c.audience as string[]) ?? [],
    audienceClasses: (c.specificClasses as string[]) ?? [],
    attachmentsCount: ((c.attachments as unknown[]) ?? []).length,
    views: (c.views as number) ?? 0,
    status: (c.status as string) ?? 'published',
    createdByMe: c.createdBy === teacher,
    createdBy: (c.createdBy as string) ?? '',
  };
}
