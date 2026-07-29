import { ApiError } from '../../lib/api-error';
import { AttendanceModel } from '../attendance/attendance.models';
import { StudentModel } from '../students/student.model';
import { SubmissionModel, TeacherAssignmentModel, TeacherClassModel } from '../teacher/teacher.models';
import { AssessmentModel, MarksEntryModel, TeacherContentModel } from './teacher-app.models';

type Doc = Record<string, unknown> & { _id: unknown };
const nowIso = (): string => new Date().toISOString();
const today = (): string => nowIso().slice(0, 10);

function splitCS(id: string): { className: string; section: string } {
  const i = id.lastIndexOf('-');
  return i === -1 ? { className: id, section: 'A' } : { className: id.slice(0, i), section: id.slice(i + 1) };
}
const keyOf = (cn: string, sec: string): string => `${cn}-${sec}`;
const MARK_IN: Record<string, string> = { present: 'present', absent: 'absent', leave: 'leave', halfDay: 'half_day', late: 'late' };
const MARK_OUT: Record<string, string> = { present: 'present', absent: 'absent', leave: 'leave', half_day: 'halfDay', late: 'late' };

function gradeFor(pct: number): string {
  if (pct >= 90) return 'A+';
  if (pct >= 80) return 'A';
  if (pct >= 70) return 'B+';
  if (pct >= 60) return 'B';
  if (pct >= 50) return 'C';
  if (pct >= 33) return 'D';
  return 'E';
}

async function myClasses(schoolId: string, teacherUserId: string) {
  return TeacherClassModel.find({ schoolId, teacherUserId }).lean();
}
async function roster(schoolId: string, classSectionId: string) {
  const { className, section } = splitCS(classSectionId);
  return StudentModel.find({ schoolId, className, section, profileStatus: 'active' }).sort({ rollNumber: 1 }).lean();
}
const rosterRow = (s: Doc, i: number) => ({
  id: String(s._id),
  name: s.name as string,
  roll: (s.rollNumber as string) || String(i + 1),
  admissionNumber: (s.admissionNumber as string) ?? '',
  avatarUrl: s.photoUrl as string | undefined,
});

function assignmentView(a: Doc): Record<string, unknown> {
  return {
    id: String(a._id),
    classSectionId: a.classKey,
    classSectionLabel: a.classKey,
    subject: a.subject,
    title: a.title,
    description: a.description ?? '',
    dueDate: a.dueDate ?? '',
    maxMarks: a.maxMarks,
    allowLate: true,
    allowResubmit: false,
    allowText: true,
    attachments: [],
    active: a.status !== 'closed',
    createdAt: a.assignedDate ?? '',
  };
}

const SUB_STATUS: Record<string, string> = { pending: 'not_submitted', submitted: 'submitted', late: 'submitted_late', graded: 'graded' };

export const teacherAppService = {
  async teaching(schoolId: string, teacherUserId: string) {
    const classes = await myClasses(schoolId, teacherUserId);
    const classTeacher: unknown[] = [];
    const subjectTeacher: unknown[] = [];
    for (const c of classes) {
      const key = keyOf(c.className as string, c.section as string);
      if (c.isClassTeacher) classTeacher.push({ id: String(c._id), kind: 'class_teacher', classSectionId: key, classSectionLabel: key });
      for (const subject of (c.subjects as string[]) ?? []) {
        subjectTeacher.push({ id: `${String(c._id)}:${subject}`, kind: 'subject_teacher', classSectionId: key, classSectionLabel: key, subject });
      }
    }
    return { classTeacher, subjectTeacher };
  },

  async roster(schoolId: string, classSectionId: string) {
    return (await roster(schoolId, classSectionId)).map((s, i) => rosterRow(s as Doc, i));
  },

  async dashboard(schoolId: string, teacherUserId: string) {
    const classes = await myClasses(schoolId, teacherUserId);
    const pending: unknown[] = [];
    for (const c of classes) {
      if (!c.isClassTeacher) continue;
      const key = keyOf(c.className as string, c.section as string);
      const marked = await AttendanceModel.countDocuments({ schoolId, className: c.className, section: c.section, date: today() });
      if (marked === 0) pending.push({ classSectionId: key, classSectionLabel: key });
    }
    return { today: [], attendancePending: pending, badges: { attendancePending: pending.length } };
  },

  // ── Assignment management ──
  async getAssignments(schoolId: string, teacherUserId: string, classSectionId: string) {
    const q: Record<string, unknown> = { schoolId, teacherUserId, status: { $ne: 'closed' } };
    if (classSectionId) q.classKey = classSectionId;
    return (await TeacherAssignmentModel.find(q).sort({ assignedDate: -1 }).lean()).map((a) => assignmentView(a as Doc));
  },
  async createAssignment(schoolId: string, teacherUserId: string, p: Record<string, unknown>) {
    const doc = await TeacherAssignmentModel.create({
      schoolId,
      teacherUserId,
      classKey: p.classSectionId,
      subject: p.subject,
      title: p.title,
      description: p.description,
      maxMarks: p.maxMarks,
      assignedDate: today(),
      dueDate: p.dueDate,
      status: 'active',
    });
    return assignmentView(doc.toObject() as Doc);
  },
  async updateAssignment(schoolId: string, teacherUserId: string, id: string, p: Record<string, unknown>) {
    const doc = await TeacherAssignmentModel.findOneAndUpdate(
      { _id: id, schoolId, teacherUserId },
      { $set: { title: p.title, description: p.description, dueDate: p.dueDate, subject: p.subject, maxMarks: p.maxMarks } },
      { new: true },
    );
    if (!doc) throw ApiError.notFound('Assignment not found');
    return assignmentView(doc.toObject() as Doc);
  },
  async deactivateAssignment(schoolId: string, teacherUserId: string, id: string) {
    const r = await TeacherAssignmentModel.updateOne({ _id: id, schoolId, teacherUserId }, { $set: { status: 'closed' } });
    if (!r.matchedCount) throw ApiError.notFound('Assignment not found');
  },
  async submissions(schoolId: string, id: string) {
    const a = await TeacherAssignmentModel.findOne({ _id: id, schoolId }).lean();
    if (!a) throw ApiError.notFound('Assignment not found');
    const students = await roster(schoolId, a.classKey as string);
    const subs = await SubmissionModel.find({ schoolId, assignmentId: id }).lean();
    const subByStudent = new Map(subs.map((s) => [String(s.studentId), s as unknown as Doc]));
    const summary: Record<string, number> = { not_submitted: 0, submitted: 0, submitted_late: 0, graded: 0 };
    const rows = students.map((st, i) => {
      const sub = subByStudent.get(String(st._id));
      const status = sub ? SUB_STATUS[String(sub.status)] ?? 'not_submitted' : 'not_submitted';
      summary[status] = (summary[status] ?? 0) + 1;
      return {
        studentId: String(st._id),
        name: st.name as string,
        roll: (st.rollNumber as string) || String(i + 1),
        avatarUrl: st.photoUrl as string | undefined,
        status,
        submittedAt: sub?.submittedAt as string | undefined,
        late: Boolean(sub?.late),
        files: (sub?.files as unknown[]) ?? [],
        text: sub?.textContent as string | undefined,
        grade: sub && sub.status === 'graded' ? { marks: Number(sub.marks ?? 0), maxMarks: Number(a.maxMarks ?? 100), feedback: sub.feedback } : undefined,
      };
    });
    return { assignment: assignmentView(a as Doc), submissions: rows, summary };
  },
  async grade(schoolId: string, id: string, studentId: string, p: { marks: number; feedback?: string }) {
    const doc = await SubmissionModel.findOneAndUpdate(
      { schoolId, assignmentId: id, studentId },
      { $set: { status: 'graded', marks: p.marks, feedback: p.feedback } },
      { new: true, upsert: true },
    );
    void doc;
    return this.submissions(schoolId, id);
  },

  // ── Attendance ──
  async getAttendance(schoolId: string, classSectionId: string, date: string) {
    const students = await roster(schoolId, classSectionId);
    const recs = await AttendanceModel.find({ schoolId, studentId: { $in: students.map((s) => s._id) }, date }).lean();
    const byStudent = new Map(recs.map((r) => [String(r.studentId), r]));
    const entries = students
      .filter((s) => byStudent.has(String(s._id)))
      .map((s) => ({ studentId: String(s._id), status: MARK_OUT[String(byStudent.get(String(s._id))?.status)] ?? 'present' }));
    const locked = date < today();
    return {
      date,
      classSectionId,
      locked,
      editable: !locked,
      cutoff: '10:00 AM',
      entries,
      recorded: recs.length > 0,
    };
  },
  async submitAttendance(schoolId: string, classSectionId: string, date: string, entries: Array<{ studentId: string; status: string }>, markedBy: string) {
    const { className, section } = splitCS(classSectionId);
    await Promise.all(
      entries.map((e) =>
        AttendanceModel.updateOne(
          { schoolId, studentId: e.studentId, date },
          { $set: { schoolId, studentId: e.studentId, date, status: MARK_IN[e.status] ?? 'present', className, section, markedBy } },
          { upsert: true },
        ),
      ),
    );
    return this.getAttendance(schoolId, classSectionId, date);
  },

  // ── Content ──
  contentView(d: Doc) {
    return {
      id: String(d._id),
      type: d.type,
      classSectionId: d.classSectionId,
      classSectionLabel: d.classSectionLabel,
      subject: d.subject,
      title: d.title,
      body: d.body ?? '',
      date: d.date ?? '',
      endDate: d.endDate,
      topic: d.topic,
      objectives: d.objectives,
      attachments: (d.attachments as unknown[]) ?? [],
      active: d.active !== false,
      createdAt: (d.createdAt as Date)?.toISOString?.() ?? '',
    };
  },
  async getContent(schoolId: string, teacherUserId: string, type: string, classSectionId: string) {
    const q: Record<string, unknown> = { schoolId, teacherUserId, active: true };
    if (type) q.type = type;
    if (classSectionId) q.classSectionId = classSectionId;
    return (await TeacherContentModel.find(q).sort({ date: -1 }).lean()).map((d) => this.contentView(d as Doc));
  },
  async createContent(schoolId: string, teacherUserId: string, p: Record<string, unknown>) {
    const doc = await TeacherContentModel.create({
      schoolId,
      teacherUserId,
      type: p.type ?? 'homework',
      classSectionId: p.classSectionId,
      classSectionLabel: p.classSectionId,
      subject: p.subject,
      title: p.title,
      body: p.body,
      date: (p.date as string) || today(),
      endDate: p.endDate,
      topic: p.topic,
      objectives: p.objectives,
      attachments: p.attachments ?? [],
      active: true,
    });
    return this.contentView(doc.toObject() as Doc);
  },
  async updateContent(schoolId: string, teacherUserId: string, id: string, p: Record<string, unknown>) {
    const doc = await TeacherContentModel.findOneAndUpdate(
      { _id: id, schoolId, teacherUserId },
      { $set: { title: p.title, body: p.body, date: p.date, endDate: p.endDate, topic: p.topic, objectives: p.objectives, subject: p.subject } },
      { new: true },
    );
    if (!doc) throw ApiError.notFound('Content not found');
    return this.contentView(doc.toObject() as Doc);
  },
  async deactivateContent(schoolId: string, teacherUserId: string, id: string) {
    const r = await TeacherContentModel.updateOne({ _id: id, schoolId, teacherUserId }, { $set: { active: false } });
    if (!r.matchedCount) throw ApiError.notFound('Content not found');
  },

  // ── Marks ──
  assessmentView(a: Doc) {
    return {
      id: String(a._id),
      name: a.name,
      subject: a.subject,
      workflowState: a.workflowState,
      editable: a.workflowState !== 'published',
      components: (a.components as unknown[]) ?? [],
    };
  },
  async getAssessments(schoolId: string, subjectId?: string) {
    const q: Record<string, unknown> = { schoolId };
    if (subjectId) q.subject = subjectId;
    return (await AssessmentModel.find(q).sort({ createdAt: -1 }).lean()).map((a) => this.assessmentView(a as Doc));
  },
  async marksSheet(schoolId: string, assessmentId: string, classSectionId: string) {
    const a = await AssessmentModel.findOne({ _id: assessmentId, schoolId }).lean();
    if (!a) throw ApiError.notFound('Assessment not found');
    const components = (a.components as Array<{ key: string; max: number }>) ?? [];
    const students = await roster(schoolId, classSectionId);
    const entries = await MarksEntryModel.find({ schoolId, assessmentId }).lean();
    const byStudent = new Map(entries.map((e) => [String(e.studentId), (e.marks as Record<string, number | null>) ?? {}]));
    const maxTotal = components.reduce((s, c) => s + Number(c.max ?? 0), 0);
    const rows = students.map((st) => ({ studentId: String(st._id), marks: byStudent.get(String(st._id)) ?? {} }));
    const preview = rows.map((r) => {
      const total = components.reduce((s, c) => s + Number(r.marks[c.key] ?? 0), 0);
      const pct = maxTotal ? Math.round((total / maxTotal) * 100) : 0;
      return { studentId: r.studentId, total, percentage: pct, grade: gradeFor(pct), result: pct >= Number(a.passPercent ?? 33) ? 'pass' : 'fail' };
    });
    return { assessmentId, workflowState: a.workflowState, editable: a.workflowState !== 'published', components, rows, preview };
  },
  async saveMarks(schoolId: string, assessmentId: string, classSectionId: string, rows: Array<{ studentId: string; marks: Record<string, number | null> }>, action?: string) {
    const a = await AssessmentModel.findOne({ _id: assessmentId, schoolId });
    if (!a) throw ApiError.notFound('Assessment not found');
    if (a.workflowState === 'published') throw ApiError.conflict('Assessment is published and locked');
    await Promise.all(
      rows.map((r) =>
        MarksEntryModel.updateOne(
          { schoolId, assessmentId, studentId: r.studentId },
          { $set: { schoolId, assessmentId, studentId: r.studentId, marks: r.marks } },
          { upsert: true },
        ),
      ),
    );
    if (action === 'submit') a.workflowState = 'submitted';
    if (action === 'publish') a.workflowState = 'published';
    if (action) await a.save();
    return this.marksSheet(schoolId, assessmentId, classSectionId);
  },

  // ── Performance ──
  async attendancePct(schoolId: string, studentId: string): Promise<number> {
    const recs = await AttendanceModel.find({ schoolId, studentId }).lean();
    if (!recs.length) return 100;
    const present = recs.filter((r) => r.status === 'present' || r.status === 'half_day').length;
    return Math.round((present / recs.length) * 100);
  },
  async performance(schoolId: string, classSectionId: string) {
    const students = await roster(schoolId, classSectionId);
    const assignments = await TeacherAssignmentModel.find({ schoolId, classKey: classSectionId, status: { $ne: 'closed' } }).lean();
    const totalAssign = assignments.length;
    return Promise.all(
      students.map(async (st, i) => {
        const sid = String(st._id);
        const [attPct, submitted, marks] = await Promise.all([
          this.attendancePct(schoolId, sid),
          SubmissionModel.countDocuments({ schoolId, studentId: sid, status: { $in: ['submitted', 'late', 'graded'] } }),
          MarksEntryModel.find({ schoolId, studentId: sid }).lean(),
        ]);
        const avg = marks.length
          ? Math.round(
              marks.reduce((s, m) => {
                const vals = Object.values((m.marks as Record<string, number>) ?? {}).filter((v) => typeof v === 'number');
                return s + (vals.length ? vals.reduce((x, y) => x + y, 0) : 0);
              }, 0) / marks.length,
            )
          : 0;
        return {
          studentId: sid,
          name: st.name as string,
          roll: (st.rollNumber as string) || String(i + 1),
          avatarUrl: st.photoUrl as string | undefined,
          attendancePct: attPct,
          avgPercentage: avg,
          assignmentsCompleted: submitted,
          assignmentsTotal: totalAssign,
        };
      }),
    );
  },
  async studentPerformance(schoolId: string, classSectionId: string, studentId: string) {
    const st = await StudentModel.findOne({ _id: studentId, schoolId }).lean();
    if (!st) throw ApiError.notFound('Student not found');
    const [attPct, submitted, entries] = await Promise.all([
      this.attendancePct(schoolId, studentId),
      SubmissionModel.countDocuments({ schoolId, studentId, status: { $in: ['submitted', 'late', 'graded'] } }),
      MarksEntryModel.find({ schoolId, studentId }).lean(),
    ]);
    const totalAssign = await TeacherAssignmentModel.countDocuments({ schoolId, classKey: classSectionId, status: { $ne: 'closed' } });
    const assessments = await Promise.all(
      entries.map(async (e) => {
        const a = await AssessmentModel.findById(e.assessmentId).lean();
        const components = (a?.components as Array<{ key: string; max: number }>) ?? [];
        const maxTotal = components.reduce((s, c) => s + Number(c.max ?? 0), 0);
        const total = components.reduce((s, c) => s + Number((e.marks as Record<string, number>)?.[c.key] ?? 0), 0);
        const pct = maxTotal ? Math.round((total / maxTotal) * 100) : 0;
        return { name: (a?.name as string) ?? 'Assessment', percentage: pct, grade: gradeFor(pct), result: pct >= Number(a?.passPercent ?? 33) ? 'pass' : 'fail' };
      }),
    );
    return {
      student: { id: studentId, name: st.name as string, roll: (st.rollNumber as string) ?? '', avatarUrl: st.photoUrl as string | undefined },
      attendancePct: attPct,
      assessments,
      assignments: { completed: submitted, total: totalAssign },
    };
  },
};
