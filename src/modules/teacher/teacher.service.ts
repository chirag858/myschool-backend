import { getInchargeSection } from '../academics/academics.service';
import { ApiError } from '../../lib/api-error';
import { AttendanceModel } from '../attendance/attendance.models';
import { CircularModel } from '../communication/communication.models';
import { assignedClassesOf } from '../coordinator/coordinator.service';
import { ExamModel } from '../exams/exams.models';
import { StudentModel } from '../students/student.model';
import { timetableService } from '../timetable/timetable.service';
import { UserModel } from '../user/user.model';
import {
  HomeworkSubmissionModel,
  SubmissionModel,
  TeacherAssignmentModel,
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
const keyOf = (className: string, section: string): string => `${className}-${section}`;

/** The one class this teacher is incharge of (single source of truth for
 * "my classes"/"my students" and every whole-class management action) —
 * distinct from `timetableService.getMyTeachingAssignments`, the real
 * timetable-derived multi-row subject-teaching set used only by marks entry
 * (`getMyExams`), unaffected by this. */
async function myInchargeClass(schoolId: string, userId: string) {
  return getInchargeSection(schoolId, userId);
}

function assertInchargeOf(
  incharge: Awaited<ReturnType<typeof getInchargeSection>>,
  classKey: string,
): void {
  if (!incharge) throw ApiError.forbidden('You are not assigned as a class incharge');
  if (incharge.classKey !== classKey) {
    throw ApiError.forbidden('You can only manage the class you are incharge of');
  }
}

interface TeachingScopeRow {
  classKey: string;
  className: string;
  section: string;
  subjects: string[];
}

/** Every class/subject a teacher may create homework or assignments for:
 * the union of what they actually teach per the timetable, plus (if
 * applicable) every subject taught in the one class they're incharge of —
 * incharge status lets them manage the whole class even for subjects they
 * don't personally teach. */
async function myTeachingScope(schoolId: string, userId: string): Promise<TeachingScopeRow[]> {
  const [assignments, incharge] = await Promise.all([
    timetableService.getMyTeachingAssignments(schoolId, userId),
    myInchargeClass(schoolId, userId),
  ]);
  const byKey = new Map<string, TeachingScopeRow>();
  for (const a of assignments) {
    const classKey = keyOf(a.className, a.section);
    const entry = byKey.get(classKey) ?? { classKey, className: a.className, section: a.section, subjects: [] };
    entry.subjects = Array.from(new Set([...entry.subjects, ...a.subjects]));
    byKey.set(classKey, entry);
  }
  if (incharge) {
    const tt = await timetableService.getTimetable(schoolId, incharge.classId, incharge.section);
    const subjects = Array.from(new Set(tt.slots.map((s) => s.subjectName)));
    const entry = byKey.get(incharge.classKey) ?? {
      classKey: incharge.classKey,
      className: incharge.className,
      section: incharge.section,
      subjects: [],
    };
    entry.subjects = Array.from(new Set([...entry.subjects, ...subjects]));
    byKey.set(incharge.classKey, entry);
  }
  return Array.from(byKey.values());
}

function assertCanTeach(scope: TeachingScopeRow[], classKey: string, subject?: string): void {
  const row = scope.find((r) => r.classKey === classKey);
  if (!row) throw ApiError.forbidden('You do not teach this class');
  if (subject !== undefined && !row.subjects.includes(subject)) {
    throw ApiError.forbidden('You do not teach this subject in this class');
  }
}

export const teacherService = {
  /** Every class/subject this teacher may create homework/assignments for —
   * exposed so the frontend picker matches the server-side check exactly. */
  async getMyTeaching(schoolId: string, userId: string): Promise<TeachingScopeRow[]> {
    return myTeachingScope(schoolId, userId);
  },

  async getMyClasses(schoolId: string, userId: string) {
    const incharge = await myInchargeClass(schoolId, userId);
    if (!incharge) return [];
    const { className, section, classKey, classId } = incharge;
    const [total, todays, classTimetable, mySlots] = await Promise.all([
      StudentModel.countDocuments({ schoolId, className, section, profileStatus: 'active' }),
      AttendanceModel.find({ schoolId, className, section, date: today() }).lean(),
      timetableService.getTimetable(schoolId, classId, section),
      timetableService.getMySchedule(schoolId, userId),
    ]);
    const present = todays.filter((r) => r.status === 'present').length;
    const absent = todays.filter((r) => r.status === 'absent').length;
    // Subjects offered for this class = every subject actually timetabled
    // there, so the incharge can target homework/circulars at any subject
    // taught here even if they don't personally teach it themselves.
    const subjects = Array.from(new Set(classTimetable.slots.map((s) => s.subjectName)));
    const periodsPerWeek = mySlots.filter((s) => s.classId === classId && s.section === section).length;
    return [
      {
        id: incharge.sectionId,
        classKey,
        className,
        section,
        subjects,
        totalStudents: total,
        periodsPerWeek,
        attendanceToday: { status: todays.length ? 'marked' : 'pending', present, absent },
      },
    ];
  },

  async getMyStudents(schoolId: string, userId: string, filter: { classKey?: string; search?: string }) {
    const incharge = await myInchargeClass(schoolId, userId);
    const myKeys = incharge ? new Set([incharge.classKey]) : new Set<string>();
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
    const assignments = await timetableService.getMyTeachingAssignments(schoolId, userId);
    // Exams created via the admin UI store `classes` as full `classKey`s
    // ("Class 1-A"); older/seeded exams store bare class names ("Class 1")
    // with no section. Both are live in the same school, so a teacher's
    // assignment must match either form or exams in the newer format are
    // silently invisible to them.
    const matchTokens = (a: (typeof assignments)[number]): string[] => [a.className, keyOf(a.className, a.section)];
    const myTokens = new Set(assignments.flatMap(matchTokens));
    const exams = (await ExamModel.find({ schoolId }).lean()).filter((e) =>
      (e.classes ?? []).some((c) => myTokens.has(c)),
    );
    const rows: Array<Record<string, unknown>> = [];
    for (const e of exams) {
      for (const a of assignments) {
        const tokens = matchTokens(a);
        if (!(e.classes ?? []).some((c) => tokens.includes(c))) continue;
        for (const subject of a.subjects) {
          rows.push({
            id: `${String(e._id)}:${keyOf(a.className, a.section)}:${subject}`,
            // The real exam _id — `id` above is a composite row key and must
            // never be sent back to /exams/:id.
            examId: String(e._id),
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

  /** `allowedClassKeys`, when given (a coordinator's non-empty assignedClasses),
   * is a hard boundary ANDed on top of the client's own filters — even a
   * request for "all classes" can never surface a class outside it. */
  async getAllHomework(schoolId: string, filters: Record<string, string>, allowedClassKeys?: readonly string[]) {
    const q: Record<string, unknown> = { schoolId };
    if (filters.type && filters.type !== 'all') q.homeworkType = filters.type;
    if (filters.classKey && filters.classKey !== 'all') q.classKey = filters.classKey;
    if (filters.subject && filters.subject !== 'all') q.subject = filters.subject;
    if (allowedClassKeys?.length) q.classKey = q.classKey ?? { $in: allowedClassKeys };
    const rows = (await TeacherHomeworkModel.find(q).sort({ assignedDate: -1 }).lean()).map(dto);
    // `section` lives either in its own field or as the tail of classKey, so it
    // is filtered after the query rather than as a Mongo condition.
    let scoped = rows;
    if (allowedClassKeys?.length && q.classKey && typeof q.classKey === 'string') {
      // filters.classKey was already a specific class — still verify it's within bounds.
      scoped = allowedClassKeys.includes(q.classKey) ? rows : [];
    }
    if (!filters.section || filters.section === 'all') return scoped;
    return scoped.filter((r) => sectionOf(r) === filters.section);
  },

  async getHomeworkById(schoolId: string, id: string) {
    const hw = await TeacherHomeworkModel.findOne({ _id: id, schoolId }).lean();
    if (!hw) throw ApiError.notFound('Homework not found');
    return dto(hw);
  },

  async createHomework(schoolId: string, userId: string, payload: Record<string, unknown>, role: string) {
    const { id, submissions, editHistory, createdBy, createdById, ...fields } = payload;
    void id;
    void submissions;
    void editHistory;
    void createdBy;
    void createdById;
    if (role === 'teacher') {
      const scope = await myTeachingScope(schoolId, userId);
      assertCanTeach(scope, String(fields.classKey ?? ''), String(fields.subject ?? ''));
    }
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
    // A teacher may only edit their own homework; admin/principal may edit
    // any; a coordinator with a non-empty assignedClasses may only edit
    // homework for their supervised classes, and the edit trail records who
    // did it.
    if (role === 'teacher' && String(hw.teacherUserId) !== userId) {
      throw ApiError.forbidden('You can only edit homework you created');
    }
    if (role === 'teacher' && (patch.classKey !== undefined || patch.subject !== undefined)) {
      const scope = await myTeachingScope(schoolId, userId);
      const classKey = String(patch.classKey ?? hw.classKey);
      const subject = String(patch.subject ?? hw.subject);
      assertCanTeach(scope, classKey, subject);
    }
    if (role === 'coordinator') {
      const allowed = await assignedClassesOf(userId);
      const targetClassKey = String(patch.classKey ?? hw.classKey);
      if (allowed.length && (!allowed.includes(targetClassKey) || !allowed.includes(String(hw.classKey)))) {
        throw ApiError.forbidden('You can only edit homework for your assigned classes');
      }
    }
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
    await HomeworkSubmissionModel.deleteMany({ schoolId, homeworkId: id });
  },

  /** Materialises one persisted row per student in the class on first read,
   * then returns the stored rows. New students joining later get a row added
   * on the next read rather than silently missing from the list. */
  async getHomeworkSubmissions(schoolId: string, id: string) {
    const hw = await TeacherHomeworkModel.findOne({ _id: id, schoolId }).lean();
    if (!hw) throw ApiError.notFound('Homework not found');
    const [className, section] = splitKey(hw.classKey as string);
    const students = await StudentModel.find({ schoolId, className, section, profileStatus: 'active' })
      .sort({ rollNumber: 1 })
      .lean();

    const existing = await HomeworkSubmissionModel.find({ schoolId, homeworkId: id }).lean();
    const have = new Set(existing.map((r) => String(r.studentId)));
    const missing = students.filter((s) => !have.has(String(s._id)));
    if (missing.length > 0) {
      await HomeworkSubmissionModel.insertMany(
        missing.map((s, i) => ({
          schoolId,
          homeworkId: id,
          studentId: String(s._id),
          studentName: s.name,
          rollNo: Number(s.rollNumber) || existing.length + i + 1,
          status: 'pending',
        })),
        { ordered: false },
      );
    }

    const rows = await HomeworkSubmissionModel.find({ schoolId, homeworkId: id }).sort({ rollNo: 1 }).lean();
    return rows.map(homeworkSubmissionView);
  },

  /** Teacher records what a student actually handed in. Also keeps the
   * homework's `submissions` counter in step with the stored rows. */
  async setHomeworkSubmission(
    schoolId: string,
    id: string,
    studentId: string,
    patch: { status: string; marks?: number; remark?: string; attachment?: string },
  ) {
    const hw = await TeacherHomeworkModel.findOne({ _id: id, schoolId }).lean();
    if (!hw) throw ApiError.notFound('Homework not found');

    const set: Record<string, unknown> = { status: patch.status };
    if (patch.marks !== undefined) set.marks = patch.marks;
    if (patch.remark !== undefined) set.remark = patch.remark;
    if (patch.attachment !== undefined) set.attachment = patch.attachment;
    // Stamp the hand-in time when moving into a submitted-like state, clear it
    // when moving back to pending. Mongoose drops `undefined` from `$set`, so
    // clearing has to go through `$unset`.
    const update: Record<string, unknown> = { $set: set };
    if (patch.status === 'pending') update.$unset = { submittedAt: '' };
    else set.submittedAt = nowIso();

    const doc = await HomeworkSubmissionModel.findOneAndUpdate({ schoolId, homeworkId: id, studentId }, update, { new: true });
    if (!doc) throw ApiError.notFound('Submission not found');

    await syncHomeworkCount(schoolId, id);
    return homeworkSubmissionView(doc.toObject());
  },

  /** Stamps every still-pending row so the UI can show who has already been
   * chased, mirroring the attendance absentee-alert pattern. */
  async remindPendingHomework(schoolId: string, id: string) {
    const hw = await TeacherHomeworkModel.findOne({ _id: id, schoolId }).lean();
    if (!hw) throw ApiError.notFound('Homework not found');
    const r = await HomeworkSubmissionModel.updateMany(
      { schoolId, homeworkId: id, status: 'pending' },
      { $set: { reminderSentAt: nowIso() } },
    );
    return { sent: r.matchedCount };
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
    const [total, submitted, graded] = await Promise.all([
      StudentModel.countDocuments({ schoolId, className, section, profileStatus: 'active' }),
      SubmissionModel.countDocuments({ schoolId, assignmentId: String(a._id), status: { $in: ['submitted', 'late', 'graded'] } }),
      SubmissionModel.countDocuments({ schoolId, assignmentId: String(a._id), status: 'graded' }),
    ]);
    const base = dto(a);
    return {
      ...base,
      // `overdue` is derived, never stored: an active assignment past its due
      // date is overdue until the teacher closes it.
      status: base.status === 'active' && String(base.dueDate ?? '') && String(base.dueDate) < today() ? 'overdue' : base.status,
      totalStudents: total,
      submitted,
      graded,
      pending: Math.max(total - submitted, 0),
    };
  },

  async createAssignment(schoolId: string, userId: string, payload: Record<string, unknown>, role: string) {
    const { id, totalStudents, submitted, pending, ...fields } = payload;
    void id;
    void totalStudents;
    void submitted;
    void pending;
    if (role === 'teacher') {
      const scope = await myTeachingScope(schoolId, userId);
      assertCanTeach(scope, String(fields.classKey ?? ''), String(fields.subject ?? ''));
    }
    const doc = await TeacherAssignmentModel.create({
      schoolId,
      teacherUserId: userId,
      ...fields,
      assignedDate: (fields.assignedDate as string) || today(),
      status: (fields.status as string) || 'active',
    });
    return this.assignmentView(schoolId, doc.toObject() as Doc);
  },

  async updateAssignment(schoolId: string, userId: string, id: string, patch: Record<string, unknown>, role: string) {
    const { id: _id, totalStudents, submitted, graded, pending, assignedDate, ...fields } = patch;
    void _id;
    void totalStudents;
    void submitted;
    void graded;
    void pending;
    void assignedDate;
    if (role === 'teacher' && (fields.classKey !== undefined || fields.subject !== undefined)) {
      const [scope, existing] = await Promise.all([
        myTeachingScope(schoolId, userId),
        TeacherAssignmentModel.findOne({ _id: id, schoolId }).lean(),
      ]);
      const classKey = String(fields.classKey ?? existing?.classKey ?? '');
      const subject = String(fields.subject ?? existing?.subject ?? '');
      assertCanTeach(scope, classKey, subject);
    }
    const doc = await TeacherAssignmentModel.findOneAndUpdate(
      { _id: id, schoolId, teacherUserId: userId },
      { $set: fields },
      { new: true },
    );
    if (!doc) throw ApiError.notFound('Assignment not found');
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
    // Materialise one row per student in the class, all genuinely pending until
    // the teacher records a hand-in. Students added later get a row on the next
    // read rather than being missing from the list.
    const [className, section] = splitKey(a.classKey as string);
    const students = await StudentModel.find({ schoolId, className, section, profileStatus: 'active' }).sort({ rollNumber: 1 }).lean();
    const existing = await SubmissionModel.find({ schoolId, assignmentId: id }).lean();
    const have = new Set(existing.map((r) => String(r.studentId)));
    const missing = students.filter((s) => !have.has(String(s._id)));
    if (missing.length > 0) {
      await SubmissionModel.insertMany(
        missing.map((s) => ({
          schoolId,
          assignmentId: id,
          studentId: String(s._id),
          studentName: s.name,
          className: `${className}-${section}`,
          status: 'pending',
        })),
        { ordered: false },
      );
    }
    const rows = await SubmissionModel.find({ schoolId, assignmentId: id }).sort({ studentName: 1 }).lean();
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

  /** Teacher records that a student handed the assignment in (or takes it back
   * to pending). Late is derived from the assignment's due date. */
  async receiveSubmission(
    schoolId: string,
    id: string,
    studentId: string,
    payload: { status: string; textContent?: string; fileName?: string },
  ) {
    const a = await TeacherAssignmentModel.findOne({ _id: id, schoolId }).lean();
    if (!a) throw ApiError.notFound('Assignment not found');

    const set: Record<string, unknown> = {};
    if (payload.textContent !== undefined) set.textContent = payload.textContent;
    if (payload.fileName !== undefined) set.fileName = payload.fileName;
    const update: Record<string, unknown> = { $set: set };
    if (payload.status === 'pending') {
      set.status = 'pending';
      // `$set: { submittedAt: undefined }` is a no-op in Mongoose.
      update.$unset = { submittedAt: '' };
    } else {
      const due = String(a.dueDate ?? '');
      set.status = due && today() > due ? 'late' : 'submitted';
      set.submittedAt = nowIso();
    }

    const doc = await SubmissionModel.findOneAndUpdate({ schoolId, assignmentId: id, studentId }, update, { new: true });
    if (!doc) throw ApiError.notFound('Submission not found');
    const r = doc.toObject();
    return {
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
    };
  },

  async gradeSubmission(schoolId: string, id: string, studentId: string, payload: { marks: number; feedback: string }) {
    const a = await TeacherAssignmentModel.findOne({ _id: id, schoolId }).lean();
    if (!a) throw ApiError.notFound('Assignment not found');
    const max = Number(a.maxMarks ?? 0);
    if (payload.marks < 0 || (max > 0 && payload.marks > max)) {
      throw ApiError.badRequest(`Marks must be between 0 and ${max}`);
    }
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
    return rows.map((c) => circularView(c, name, userId));
  },
  async getMyCirculars(schoolId: string, userId: string) {
    const name = await teacherName(userId);
    // Match on the author id; fall back to the display name so circulars
    // written before `createdById` existed still show up as "mine".
    const rows = await CircularModel.find({
      schoolId,
      $or: [{ createdById: userId }, { createdById: { $in: ['', null] }, createdBy: name }],
    })
      .sort({ dateOfIssue: -1 })
      .lean();
    return rows.map((c) => circularView(c, name, userId));
  },
  async createCircular(schoolId: string, userId: string, payload: Record<string, unknown>, role: string) {
    if (role === 'teacher') {
      const incharge = await myInchargeClass(schoolId, userId);
      const targets = (payload.audienceClasses as string[] | undefined) ?? [];
      for (const classKey of targets) assertInchargeOf(incharge, classKey);
    }
    const name = await teacherName(userId);
    const count = await CircularModel.countDocuments({ schoolId });
    const doc = await CircularModel.create({
      schoolId,
      number: (payload.number as string) || `CIR/${new Date().getFullYear()}/${String(count + 1).padStart(4, '0')}`,
      title: payload.title,
      body: payload.body,
      dateOfIssue: (payload.dateOfIssue as string) || today(),
      audience: (payload.audience as string[]) || ['staff'],
      specificClasses: (payload.audienceClasses as string[]) || [],
      priority: (payload.priority as string) || 'normal',
      status: (payload.status as string) === 'draft' ? 'draft' : 'published',
      createdBy: name,
      createdById: userId,
    });
    return circularView(doc.toObject(), name, userId);
  },
  async updateCircular(schoolId: string, userId: string, id: string, patch: Record<string, unknown>, role: string) {
    const name = await teacherName(userId);
    const c = await CircularModel.findOne({ _id: id, schoolId }).lean();
    if (!c) throw ApiError.notFound('Circular not found');
    if (!isMine(c, name, userId)) throw ApiError.forbidden('You can only edit circulars you created');
    if (role === 'teacher' && patch.audienceClasses !== undefined) {
      const incharge = await myInchargeClass(schoolId, userId);
      for (const classKey of patch.audienceClasses as string[]) assertInchargeOf(incharge, classKey);
    }

    const set: Record<string, unknown> = {};
    for (const key of ['title', 'body', 'priority', 'dateOfIssue', 'status'] as const) {
      if (patch[key] !== undefined) set[key] = patch[key];
    }
    if (patch.audienceClasses !== undefined) set.specificClasses = patch.audienceClasses;
    const doc = await CircularModel.findOneAndUpdate({ _id: id, schoolId }, { $set: set }, { new: true });
    return circularView((doc as unknown as { toObject: () => Doc }).toObject(), name, userId);
  },
  async deleteCircular(schoolId: string, userId: string, id: string) {
    const name = await teacherName(userId);
    const c = await CircularModel.findOne({ _id: id, schoolId }).lean();
    if (!c) throw ApiError.notFound('Circular not found');
    if (!isMine(c, name, userId)) throw ApiError.forbidden('You can only delete circulars you created');
    await CircularModel.deleteOne({ _id: id, schoolId });
  },
  /** Counts a read. Returns the fresh view so the card's counter updates. */
  async markCircularRead(schoolId: string, userId: string, id: string) {
    const name = await teacherName(userId);
    const doc = await CircularModel.findOneAndUpdate({ _id: id, schoolId }, { $inc: { views: 1 } }, { new: true });
    if (!doc) throw ApiError.notFound('Circular not found');
    return circularView(doc.toObject(), name, userId);
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

  // Principal/school_admin review queue — a teacher's own /leave/* endpoints
  // above only ever touch their own applications, never another teacher's.
  async getAllPendingLeaves(schoolId: string) {
    const rows = await TeacherLeaveModel.find({ schoolId, status: 'pending' }).sort({ appliedOn: -1 }).lean();
    const userIds = [...new Set(rows.map((r) => String(r.teacherUserId)))];
    const users = await UserModel.find({ _id: { $in: userIds } }, { name: 1 }).lean();
    const nameById = new Map(users.map((u) => [String(u._id), u.name as string]));
    return rows.map((r) => ({
      ...dto(r),
      teacherName: nameById.get(String(r.teacherUserId)) ?? 'Teacher',
    }));
  },
  async reviewLeave(schoolId: string, id: string, action: 'approve' | 'reject', reviewerUserId: string, remarks?: string) {
    const status = action === 'approve' ? 'approved' : 'rejected';
    const decidedByName = await teacherName(reviewerUserId);
    // Atomic check-and-update on status: 'pending' — a leave already decided can't be re-decided.
    const doc = await TeacherLeaveModel.findOneAndUpdate(
      { _id: id, schoolId, status: 'pending' },
      { $set: { status, decidedBy: decidedByName, remarks, rejectionReason: action === 'reject' ? remarks : undefined } },
      { new: true },
    );
    if (!doc) {
      const exists = await TeacherLeaveModel.exists({ _id: id, schoolId });
      throw exists ? ApiError.conflict('This leave has already been decided') : ApiError.notFound('Leave not found');
    }
    return dto(doc.toObject());
  },
};

function splitKey(classKey: string): [string, string] {
  const idx = classKey.lastIndexOf('-');
  if (idx === -1) return [classKey, ''];
  return [classKey.slice(0, idx), classKey.slice(idx + 1)];
}

/** Section as stored on the homework, falling back to the tail of `classKey`. */
function sectionOf(hw: Record<string, unknown>): string {
  const explicit = String(hw.section ?? '').trim();
  if (explicit) return explicit;
  return splitKey(String(hw.classKey ?? ''))[1];
}

function homeworkSubmissionView(r: Record<string, unknown>): Record<string, unknown> {
  return {
    id: String(r._id),
    homeworkId: String(r.homeworkId),
    studentId: String(r.studentId),
    studentName: r.studentName,
    rollNo: Number(r.rollNo ?? 0),
    status: r.status,
    submittedAt: r.submittedAt ?? undefined,
    attachment: r.attachment ?? undefined,
    marks: r.marks ?? undefined,
    remark: r.remark ?? undefined,
    reminderSentAt: r.reminderSentAt ?? undefined,
  };
}

/** Keeps `homework.submissions` equal to the number of rows actually handed in. */
async function syncHomeworkCount(schoolId: string, homeworkId: string): Promise<void> {
  const submissions = await HomeworkSubmissionModel.countDocuments({
    schoolId,
    homeworkId,
    status: { $in: ['submitted', 'late', 'graded'] },
  });
  await TeacherHomeworkModel.updateOne({ _id: homeworkId, schoolId }, { $set: { submissions } });
}

function isMine(c: Doc, teacher: string, userId: string): boolean {
  const owner = String(c.createdById ?? '');
  return owner ? owner === userId : c.createdBy === teacher;
}

function circularView(c: Doc, teacher: string, userId: string): Record<string, unknown> {
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
    createdByMe: isMine(c, teacher, userId),
    createdBy: (c.createdBy as string) ?? '',
  };
}
