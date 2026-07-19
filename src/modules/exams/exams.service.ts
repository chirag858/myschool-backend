import { ApiError } from '../../lib/api-error';
import { StudentModel } from '../students/student.model';
import { ExamMarkModel, ExamModel } from './exams.models';

type Doc = Record<string, unknown> & { _id: unknown };
const num = (v: unknown): number => Number(v) || 0;
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

async function studentsInClass(schoolId: string, classKey: string) {
  return StudentModel.find({ schoolId, className: classKey }).sort({ rollNumber: 1 }).lean();
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
    const docs = await ExamModel.find({ schoolId }).lean();
    return {
      totalExams: docs.length,
      upcoming: docs.filter((e) => e.status === 'scheduled').length,
      pendingEntry: docs.filter((e) => e.status === 'marks_entry' || e.status === 'results_pending').length,
      publishedCount: docs.filter((e) => e.published).length,
    };
  },

  async upcoming(schoolId: string) {
    const docs = await ExamModel.find({ schoolId, status: 'scheduled' }).sort({ startDate: 1 }).limit(10).lean();
    return docs.map((d) => ({
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
    return submitted ? { submitted: rows.length } : { saved: rows.length };
  },

  // ── Results ──
  async results(schoolId: string, examId: string, classKey: string) {
    const exam = await ExamModel.findOne({ _id: examId, schoolId }).lean();
    if (!exam) throw ApiError.notFound('Exam not found');
    const pattern = patternFor(exam, classKey);
    const perSubjectMax = subjectMax(pattern);
    const students = await studentsInClass(schoolId, classKey);
    const marks = await ExamMarkModel.find({
      schoolId,
      examId,
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
      let allAbsent = sMarks.length > 0;
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
        grade: gradeForPercent(percentage, pattern.gradeRanges),
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
};
