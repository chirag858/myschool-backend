import { getActiveSessionName } from '../academics/academics.service';
import { ApiError } from '../../lib/api-error';
import { StudentModel } from '../students/student.model';
import { StaffModel } from '../staff/staff.models';
import { AttendanceModel } from '../attendance/attendance.models';
import { SubjectModel } from '../timetable/timetable.models';
import { ExamAuditLogModel } from './exams-progress.models';
import { ExamMarkModel, ExamModel, IdCardLogModel, ReportCardRemarksModel } from './exams.models';

type Doc = Record<string, unknown> & { _id: unknown };
const num = (v: unknown): number => Number(v) || 0;
// Older/seed data can carry non-ObjectId subjectId strings (e.g. "math") —
// filter those out before querying SubjectModel by _id to avoid a cast error.
const isObjectId = (id: string): boolean => /^[0-9a-fA-F]{24}$/.test(id);
const round = (n: number): number => Math.round(n);

interface Pattern {
  maxTheory: number;
  maxPractical: number;
  maxInternal: number;
  passingTheory: number;
  passingPractical: number;
  gradeRanges?: Array<{ minPercent: number; maxPercent: number; label: string }>;
}

const DEFAULT_PATTERN: Pattern = {
  maxTheory: 80,
  maxPractical: 20,
  maxInternal: 0,
  passingTheory: 27,
  passingPractical: 7,
  gradeRanges: [],
};

function patternFor(exam: Doc, classKey: string): Pattern {
  const byClass = (exam.patternByClass as Record<string, Pattern> | undefined) ?? {};
  const p = byClass[classKey];
  if (!p) return DEFAULT_PATTERN;
  return {
    maxTheory: num(p.maxTheory),
    maxPractical: num(p.maxPractical),
    maxInternal: num(p.maxInternal),
    passingTheory: num(p.passingTheory),
    passingPractical: num(p.passingPractical),
    gradeRanges: p.gradeRanges,
  };
}

const subjectMax = (p: Pattern): number => (p.maxTheory + p.maxPractical + p.maxInternal) || 100;

function gradeForPercent(pct: number, ranges?: Pattern['gradeRanges']): string {
  if (ranges?.length) {
    const r = ranges.find((g) => pct >= num(g.minPercent) && pct <= num(g.maxPercent));
    if (r) return r.label;
  }
  if (pct >= 90) return 'A+';
  if (pct >= 80) return 'A';
  if (pct >= 70) return 'B+';
  if (pct >= 60) return 'B';
  if (pct >= 50) return 'C';
  if (pct >= 33) return 'D';
  return 'F';
}

function divisionForPercent(pct: number): string {
  if (pct >= 75) return 'distinction';
  if (pct >= 60) return 'first';
  if (pct >= 45) return 'second';
  if (pct >= 33) return 'third';
  return 'fail';
}

interface RawMark {
  theory: number | null;
  practical: number | null;
  internal: number | null;
  isAbsent: boolean;
}

function computeMark(m: RawMark, p: Pattern): { total: number | null; grade: string | null; passFail: string | null } {
  if (m.isAbsent) return { total: null, grade: null, passFail: 'absent' };
  const total = num(m.theory) + num(m.practical) + num(m.internal);
  const pct = (total / subjectMax(p)) * 100;
  const theoryPass = num(m.theory) >= p.passingTheory;
  const practicalPass = p.maxPractical === 0 || num(m.practical) >= p.passingPractical;
  return { total, grade: gradeForPercent(pct, p.gradeRanges), passFail: theoryPass && practicalPass ? 'pass' : 'fail' };
}

function toExam(d: Doc) {
  return {
    id: String(d._id),
    name: d.name,
    type: d.type,
    session: d.session ?? '',
    classes: d.classes ?? [],
    startDate: d.startDate ?? '',
    endDate: d.endDate ?? '',
    resultDate: d.resultDate ?? '',
    description: d.description,
    status: d.status,
    published: d.published ?? false,
    patternByClass: d.patternByClass ?? {},
    dateSheet: d.dateSheet ?? [],
  };
}

/** "Upcoming" is calendar timing (dates haven't finished), independent of
 * draft/published workflow stage — archived exams are excluded by the caller. */
function isUpcoming(d: { endDate?: string; startDate?: string }, today: string): boolean {
  const end = d.endDate || d.startDate || '';
  return end >= today;
}

/** An exam can scope a class as the whole class ("Class 1", every section)
 * or one specific section ("Class 1-A") — match whichever convention the
 * caller used against however the student record actually stores it. */
async function studentsInClass(schoolId: string, classKey: string) {
  return StudentModel.find({ schoolId, $or: [{ classKey }, { className: classKey }] })
    .sort({ rollNumber: 1 })
    .lean();
}

/** Shared by results(), analytics() and reportCard() so all three always agree. */
export async function computeClassRows(schoolId: string, exam: Doc, classKey: string) {
  const pattern = patternFor(exam, classKey);
  const perSubjectMax = subjectMax(pattern);
  const students = await studentsInClass(schoolId, classKey);
  const marks = await ExamMarkModel.find({
    schoolId,
    examId: String(exam._id),
    studentId: { $in: students.map((s) => s._id) },
  }).lean();

  const byStudent = new Map<string, typeof marks>();
  for (const m of marks) {
    const k = String(m.studentId);
    if (!byStudent.has(k)) byStudent.set(k, []);
    byStudent.get(k)!.push(m);
  }

  const rows = students.map((s) => {
    const sMarks = byStudent.get(String(s._id)) ?? [];
    const subjects: Record<string, { obtained: number; max: number; grade: string; passFail: string }> = {};
    let totalObtained = 0;
    let anyFail = false;
    let allAbsent = true;
    for (const m of sMarks) {
      const d = computeMark(
        { theory: m.theory ?? null, practical: m.practical ?? null, internal: m.internal ?? null, isAbsent: m.isAbsent ?? false },
        pattern,
      );
      subjects[m.subjectId] = {
        obtained: d.total ?? 0,
        max: perSubjectMax,
        grade: d.grade ?? '-',
        passFail: d.passFail ?? 'absent',
      };
      totalObtained += d.total ?? 0;
      if (d.passFail === 'fail') anyFail = true;
      if (d.passFail !== 'absent') allAbsent = false;
    }
    const totalMax = sMarks.length * perSubjectMax;
    const percentage = totalMax ? round((totalObtained / totalMax) * 100) : 0;
    const passFail = allAbsent ? 'absent' : anyFail ? 'fail' : 'pass';
    return {
      studentId: String(s._id),
      rollNumber: s.rollNumber ?? '',
      name: s.name,
      subjects,
      totalObtained,
      totalMax,
      percentage,
      grade: passFail === 'absent' ? '-' : gradeForPercent(percentage, pattern.gradeRanges),
      division: passFail === 'absent' ? 'absent' : passFail === 'fail' ? 'fail' : divisionForPercent(percentage),
      rank: 0,
      passFail,
    };
  });

  // Rank by percentage (pass/fail students), descending.
  rows
    .slice()
    .sort((a, b) => b.percentage - a.percentage)
    .forEach((r, i) => {
      r.rank = i + 1;
    });
  return rows;
}

export const examService = {
  async list(schoolId: string) {
    const docs = await ExamModel.find({ schoolId }).sort({ createdAt: -1 }).lean();
    return docs.map(toExam);
  },

  async get(schoolId: string, id: string) {
    const d = await ExamModel.findOne({ _id: id, schoolId }).lean();
    if (!d) throw ApiError.notFound('Exam not found');
    return toExam(d);
  },

  async kpi(schoolId: string) {
    const session = await getActiveSessionName(schoolId);
    const today = new Date().toISOString().slice(0, 10);
    const docs = await ExamModel.find({ schoolId, session }).lean();
    return {
      totalExams: docs.length,
      // "Upcoming" is calendar timing, not workflow stage — a draft or an
      // already-published exam both count as upcoming as long as its dates
      // haven't finished. Archived exams are explicitly retired, never shown.
      upcoming: docs.filter((e) => isUpcoming(e, today)).length,
      pendingEntry: docs.filter((e) => e.status === 'marks_entry' || e.status === 'results_pending').length,
      publishedCount: docs.filter((e) => e.published).length,
    };
  },

  async upcoming(schoolId: string) {
    const session = await getActiveSessionName(schoolId);
    const today = new Date().toISOString().slice(0, 10);
    const docs = await ExamModel.find({ schoolId, session, status: { $ne: 'archived' } })
      .sort({ startDate: 1 })
      .lean();
    return docs
      .filter((d) => isUpcoming(d, today))
      .slice(0, 10)
      .map((d) => ({
        id: String(d._id),
        name: d.name,
        type: d.type,
        classes: (d.classes ?? []).join(', '),
        startDate: d.startDate ?? '',
        endDate: d.endDate ?? '',
        status: d.status,
      }));
  },

  async create(schoolId: string, payload: Record<string, unknown>) {
    const doc = await ExamModel.create({ schoolId, ...payload, status: 'scheduled', published: false });
    return toExam(doc.toObject());
  },

  async publish(schoolId: string, id: string) {
    const doc = await ExamModel.findOneAndUpdate(
      { _id: id, schoolId },
      { published: true, status: 'marks_entry' },
      { new: true },
    );
    if (!doc) throw ApiError.notFound('Exam not found');
    return toExam(doc.toObject());
  },

  async unpublish(schoolId: string, id: string) {
    const doc = await ExamModel.findOneAndUpdate(
      { _id: id, schoolId },
      { published: false, status: 'scheduled' },
      { new: true },
    );
    if (!doc) throw ApiError.notFound('Exam not found');
    return toExam(doc.toObject());
  },

  async remove(schoolId: string, id: string) {
    await ExamModel.deleteOne({ _id: id, schoolId });
    await ExamMarkModel.deleteMany({ schoolId, examId: id });
    return { success: true };
  },

  async saveDateSheet(schoolId: string, id: string, dateSheet: Array<Record<string, unknown>>) {
    const doc = await ExamModel.findOneAndUpdate(
      { _id: id, schoolId },
      { $set: { dateSheet } },
      { new: true },
    );
    if (!doc) throw ApiError.notFound('Exam not found');
    return toExam(doc.toObject());
  },

  // ── Marks ──
  async getMarks(schoolId: string, examId: string, classKey: string, subjectId: string) {
    const exam = await ExamModel.findOne({ _id: examId, schoolId }).lean();
    if (!exam) throw ApiError.notFound('Exam not found');
    const pattern = patternFor(exam, classKey);
    const students = await studentsInClass(schoolId, classKey);
    const marks = await ExamMarkModel.find({
      schoolId,
      examId,
      subjectId,
      studentId: { $in: students.map((s) => s._id) },
    }).lean();
    const byStudent = new Map(marks.map((m) => [String(m.studentId), m]));

    return students.map((s) => {
      const m = byStudent.get(String(s._id));
      const raw: RawMark = {
        theory: m?.theory ?? null,
        practical: m?.practical ?? null,
        internal: m?.internal ?? null,
        isAbsent: m?.isAbsent ?? false,
      };
      const d = computeMark(raw, pattern);
      return {
        studentId: String(s._id),
        rollNumber: s.rollNumber ?? '',
        name: s.name,
        photoUrl: s.photoUrl,
        isAbsent: raw.isAbsent,
        theory: raw.theory,
        practical: raw.practical,
        internal: raw.internal,
        remarks: m?.remarks,
        total: d.total,
        grade: d.grade,
        passFail: d.passFail,
      };
    });
  },

  async saveMarks(
    schoolId: string,
    examId: string,
    classKey: string,
    subjectId: string,
    rows: Array<{ studentId: string; theory?: number | null; practical?: number | null; internal?: number | null; isAbsent?: boolean; remarks?: string }>,
    submitted: boolean,
    performedBy = 'System',
  ) {
    await Promise.all(
      rows.map((r) =>
        ExamMarkModel.updateOne(
          { examId, subjectId, studentId: r.studentId },
          {
            $set: {
              schoolId,
              examId,
              classKey,
              subjectId,
              studentId: r.studentId,
              theory: r.theory ?? null,
              practical: r.practical ?? null,
              internal: r.internal ?? null,
              isAbsent: r.isAbsent ?? false,
              remarks: r.remarks,
              submitted,
            },
          },
          { upsert: true },
        ),
      ),
    );
    await ExamAuditLogModel.create({
      schoolId,
      examId,
      classKey,
      subjectId,
      action: submitted ? 'marks_submitted' : 'marks_draft_saved',
      performedBy,
      details: `${rows.length} row(s) ${submitted ? 'submitted' : 'saved as draft'}`,
      timestamp: new Date().toISOString(),
    });
    return submitted ? { submitted: rows.length } : { saved: rows.length };
  },

  // ── Results ──
  async results(schoolId: string, examId: string, classKey: string) {
    const exam = await ExamModel.findOne({ _id: examId, schoolId }).lean();
    if (!exam) throw ApiError.notFound('Exam not found');
    return computeClassRows(schoolId, exam, classKey);
  },

  // Class-wide pass/fail/average/subject-average stats for the results
  // analytics panel — computed from the same rows the results table shows,
  // so the two can never disagree.
  async analytics(schoolId: string, examId: string, classKey: string) {
    const exam = await ExamModel.findOne({ _id: examId, schoolId }).lean();
    if (!exam) throw ApiError.notFound('Exam not found');
    const rows = await computeClassRows(schoolId, exam, classKey);

    const totalStudents = rows.length;
    const pass = rows.filter((r) => r.passFail === 'pass').length;
    const fail = rows.filter((r) => r.passFail === 'fail').length;
    const absent = rows.filter((r) => r.passFail === 'absent').length;
    const eligible = rows.filter((r) => r.passFail !== 'absent');
    const passPercent = totalStudents ? round((pass / totalStudents) * 100) : 0;
    const classAverage = eligible.length
      ? round(eligible.reduce((s, r) => s + r.percentage, 0) / eligible.length)
      : 0;
    const highest = eligible.length ? Math.max(...eligible.map((r) => r.percentage)) : 0;
    const lowest = eligible.length ? Math.min(...eligible.map((r) => r.percentage)) : 0;

    const subjectIds = Array.from(new Set(rows.flatMap((r) => Object.keys(r.subjects))));
    const subjectDocs = await SubjectModel.find(
      { _id: { $in: subjectIds.filter(isObjectId) } },
      { name: 1 },
    ).lean();
    const subjectNameById = new Map(subjectDocs.map((s) => [String(s._id), s.name]));
    const subjectAverages = subjectIds.map((subjectId) => {
      const values = rows
        .map((r) => r.subjects[subjectId])
        .filter((v): v is NonNullable<typeof v> => v != null && v.passFail !== 'absent')
        .map((v) => (v.max ? (v.obtained / v.max) * 100 : 0));
      return {
        subject: subjectNameById.get(subjectId) ?? subjectId,
        averagePercent: values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : 0,
      };
    });

    const gradeCounts = new Map<string, number>();
    for (const r of eligible) gradeCounts.set(r.grade, (gradeCounts.get(r.grade) ?? 0) + 1);
    const gradeDistribution = Array.from(gradeCounts.entries()).map(([grade, count]) => ({ grade, count }));

    const topTen = eligible
      .slice()
      .sort((a, b) => b.percentage - a.percentage)
      .slice(0, 10)
      .map((r) => ({ rank: r.rank, name: r.name, percentage: r.percentage }));

    return {
      totalStudents,
      pass,
      fail,
      absent,
      passPercent,
      classAverage,
      highest,
      lowest,
      subjectAverages,
      gradeDistribution,
      topTen,
    };
  },

  // Single student's report card — profile + this exam's result + attendance.
  async reportCard(schoolId: string, examId: string, studentId: string) {
    const exam = await ExamModel.findOne({ _id: examId, schoolId }).lean();
    if (!exam) throw ApiError.notFound('Exam not found');
    const student = await StudentModel.findOne({ _id: studentId, schoolId }).lean();
    if (!student) throw ApiError.notFound('Student not found');

    const rows = await computeClassRows(schoolId, exam, student.className ?? '');
    const row = rows.find((r) => r.studentId === studentId);
    if (!row) throw ApiError.notFound('Student is not enrolled in this exam class');

    const subjectIds = Object.keys(row.subjects);
    const [attendanceRecords, remarks, subjectDocs] = await Promise.all([
      AttendanceModel.find({ schoolId, studentId }, { status: 1 }).lean(),
      ReportCardRemarksModel.findOne({ schoolId, examId, studentId }).lean(),
      SubjectModel.find({ _id: { $in: subjectIds.filter(isObjectId) } }, { name: 1 }).lean(),
    ]);
    const presentDays = attendanceRecords.filter((a) => a.status === 'present' || a.status === 'late').length;
    const workingDays = attendanceRecords.length;
    const subjectNameById = new Map(subjectDocs.map((s) => [String(s._id), s.name]));

    return {
      studentId,
      studentName: student.name,
      admissionNumber: student.admissionNumber,
      rollNumber: student.rollNumber ?? '',
      classLabel: student.className ?? '',
      section: student.section ?? '',
      fatherName: student.fatherName ?? '',
      motherName: student.parents?.motherName ?? '',
      dateOfBirth: student.dateOfBirth ?? '',
      bloodGroup: student.bloodGroup ?? '',
      category: student.category ?? '',
      photoUrl: student.photoUrl,
      presentDays,
      workingDays,
      attendancePercent: workingDays ? round((presentDays / workingDays) * 100) : 0,
      examName: exam.name,
      session: exam.session ?? '',
      subjects: Object.entries(row.subjects).map(([subjectId, s]) => ({
        name: subjectNameById.get(subjectId) ?? subjectId,
        maxMarks: s.max,
        total: s.obtained,
        grade: s.grade,
      })),
      totalObtained: row.totalObtained,
      totalMax: row.totalMax,
      percentage: row.percentage,
      grade: row.grade,
      division: row.division,
      rank: row.rank,
      passFail: row.passFail,
      teacherRemarks: remarks?.teacherRemarks,
      principalRemarks: remarks?.principalRemarks,
    };
  },

  async bulkReportCards(schoolId: string, examId: string, classKey: string) {
    const students = await studentsInClass(schoolId, classKey);
    return Promise.all(students.map((s) => this.reportCard(schoolId, examId, String(s._id))));
  },

  async updateRemarks(
    schoolId: string,
    examId: string,
    studentId: string,
    payload: { teacherRemarks?: string; principalRemarks?: string },
  ) {
    await ReportCardRemarksModel.updateOne(
      { schoolId, examId, studentId },
      { $set: payload },
      { upsert: true },
    );
    return { success: true };
  },

  async publishResults(schoolId: string, examId: string, classKey: string) {
    const doc = await ExamModel.findOneAndUpdate(
      { _id: examId, schoolId },
      { $addToSet: { publishedResults: classKey }, status: 'published' },
      { new: true },
    );
    if (!doc) throw ApiError.notFound('Exam not found');
    return { success: true };
  },

  async unpublishResults(schoolId: string, examId: string, classKey: string) {
    const doc = await ExamModel.findOneAndUpdate(
      { _id: examId, schoolId },
      { $pull: { publishedResults: classKey } },
      { new: true },
    );
    if (!doc) throw ApiError.notFound('Exam not found');
    return { success: true };
  },

  // ── Student exam results (served under /students/:id/exams) ──
  async studentExams(schoolId: string, studentId: string) {
    const student = await StudentModel.findOne({ _id: studentId, schoolId }).lean();
    if (!student) throw ApiError.notFound('Student not found');
    const classKey = student.className ?? '';
    const exams = await ExamModel.find({ schoolId }).sort({ startDate: -1 }).lean();

    const out = [];
    for (const exam of exams) {
      if (!(exam.publishedResults ?? []).includes(classKey)) continue;
      const marks = await ExamMarkModel.find({ schoolId, examId: exam._id, studentId }).lean();
      if (marks.length === 0) continue;
      const pattern = patternFor(exam, classKey);
      const perMax = subjectMax(pattern);
      let obtained = 0;
      for (const m of marks) {
        const d = computeMark(
          { theory: m.theory ?? null, practical: m.practical ?? null, internal: m.internal ?? null, isAbsent: m.isAbsent ?? false },
          pattern,
        );
        obtained += d.total ?? 0;
      }
      const totalMarks = marks.length * perMax;
      const percentage = totalMarks ? round((obtained / totalMarks) * 100) : 0;
      out.push({
        id: String(exam._id),
        examName: exam.name,
        examDate: exam.startDate ?? '',
        totalMarks,
        obtained,
        percentage,
        grade: gradeForPercent(percentage, pattern.gradeRanges),
      });
    }
    return out;
  },

  // ── ID cards ──
  async studentIdSelections(schoolId: string) {
    const session = await getActiveSessionName(schoolId);
    const [students, logs] = await Promise.all([
      StudentModel.find({ schoolId, profileStatus: 'active' }, {
        name: 1, className: 1, section: 1, admissionNumber: 1, photoUrl: 1,
        bloodGroup: 1, parents: 1,
      }).sort({ name: 1 }).lean(),
      IdCardLogModel.find({ schoolId, kind: 'student' }).lean(),
    ]);
    const lastGeneratedById = new Map(logs.map((l) => [l.personId, l.generatedAt]));
    return students.map((s) => ({
      id: String(s._id),
      name: s.name,
      classLabel: [s.className, s.section].filter(Boolean).join(' – '),
      admissionNumber: s.admissionNumber ?? '',
      photoUrl: s.photoUrl,
      bloodGroup: s.bloodGroup ?? '',
      fatherName: s.parents?.fatherName ?? '',
      motherName: s.parents?.motherName ?? '',
      parentMobile: s.parents?.fatherMobile ?? '',
      session,
      lastGenerated: lastGeneratedById.get(String(s._id))?.toISOString(),
    }));
  },

  async staffIdSelections(schoolId: string) {
    const session = await getActiveSessionName(schoolId);
    const [staff, logs] = await Promise.all([
      StaffModel.find({ schoolId, status: 'active' }, {
        name: 1, designationLabel: 1, departmentLabel: 1, employeeId: 1,
        photoUrl: 1, bloodGroup: 1, mobile: 1, emergencyContactMobile: 1,
      }).sort({ name: 1 }).lean(),
      IdCardLogModel.find({ schoolId, kind: 'staff' }).lean(),
    ]);
    const lastGeneratedById = new Map(logs.map((l) => [l.personId, l.generatedAt]));
    return staff.map((s) => ({
      id: String(s._id),
      name: s.name,
      designation: s.designationLabel ?? '',
      department: s.departmentLabel ?? '',
      employeeId: s.employeeId ?? '',
      photoUrl: s.photoUrl,
      bloodGroup: s.bloodGroup ?? '',
      parentMobile: s.emergencyContactMobile || s.mobile || '',
      session,
      lastGenerated: lastGeneratedById.get(String(s._id))?.toISOString(),
    }));
  },

  async logIdCardGeneration(schoolId: string, kind: 'student' | 'staff', ids: readonly string[]) {
    const generatedAt = new Date();
    await Promise.all(
      ids.map((personId) =>
        IdCardLogModel.updateOne(
          { schoolId, kind, personId },
          { $set: { generatedAt } },
          { upsert: true },
        ),
      ),
    );
    return { count: ids.length };
  },
};
