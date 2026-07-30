import { ApiError } from '../../lib/api-error';
import { StudentModel } from '../students/student.model';
import { ExamAuditLogModel } from './exams-progress.models';
import { ExamMarkModel, ExamModel } from './exams.models';

type Doc = Record<string, unknown> & { _id: unknown };

function subjectsForClass(exam: Doc, classKey: string): Array<{ subjectId: string; subjectName: string }> {
  const dateSheet = (exam.dateSheet as Array<{ classKey: string; subjectId: string; subjectName: string }> | undefined) ?? [];
  const rows = dateSheet.filter((d) => d.classKey === classKey);
  const seen = new Map(rows.map((r) => [r.subjectId, r.subjectName]));
  return Array.from(seen, ([subjectId, subjectName]) => ({ subjectId, subjectName }));
}

export const examsProgressService = {
  async getClassMarksProgress(schoolId: string, examId: string) {
    const exam = await ExamModel.findOne({ _id: examId, schoolId }).lean();
    if (!exam) throw ApiError.notFound('Exam not found');
    const classes = (exam.classes as string[] | undefined) ?? [];

    const out = [];
    for (const classKey of classes) {
      let subjects = subjectsForClass(exam, classKey);
      if (subjects.length === 0) {
        // No date sheet saved yet — fall back to whatever subjects already have marks.
        const subjectIds = await ExamMarkModel.distinct('subjectId', { schoolId, examId, classKey });
        subjects = subjectIds.map((s) => ({ subjectId: s, subjectName: s }));
      }
      const studentCount = await StudentModel.countDocuments({ schoolId, $or: [{ classKey }, { className: classKey }] });
      let marksEntered = 0;
      for (const subj of subjects) {
        const submittedCount = await ExamMarkModel.countDocuments({
          schoolId,
          examId,
          classKey,
          subjectId: subj.subjectId,
          submitted: true,
        });
        if (submittedCount >= studentCount && studentCount > 0) marksEntered += 1;
      }
      const totalSubjects = subjects.length;
      out.push({
        classKey,
        subjects: totalSubjects,
        marksEntered,
        marksPending: Math.max(0, totalSubjects - marksEntered),
        completePercent: totalSubjects ? Math.round((marksEntered / totalSubjects) * 100) : 0,
      });
    }
    return out;
  },

  async getSubjectMarksStatus(schoolId: string, examId: string, classKey: string) {
    const exam = await ExamModel.findOne({ _id: examId, schoolId }).lean();
    if (!exam) throw ApiError.notFound('Exam not found');
    let subjects = subjectsForClass(exam, classKey);
    if (subjects.length === 0) {
      const subjectIds = await ExamMarkModel.distinct('subjectId', { schoolId, examId, classKey });
      subjects = subjectIds.map((s) => ({ subjectId: s, subjectName: s }));
    }
    const studentCount = await StudentModel.countDocuments({ schoolId, $or: [{ classKey }, { className: classKey }] });

    const out = [];
    for (const subj of subjects) {
      const marks = await ExamMarkModel.find({ schoolId, examId, classKey, subjectId: subj.subjectId })
        .sort({ updatedAt: -1 })
        .lean();
      const submittedCount = marks.filter((m) => m.submitted).length;
      const status =
        marks.length === 0
          ? 'pending'
          : submittedCount >= studentCount && studentCount > 0
            ? 'submitted'
            : 'in_progress';
      const lastAudit = await ExamAuditLogModel.findOne({ schoolId, examId, classKey, subjectId: subj.subjectId })
        .sort({ createdAt: -1 })
        .lean();
      out.push({
        subjectId: subj.subjectId,
        subjectName: subj.subjectName,
        teacherName: lastAudit?.performedBy ?? '—',
        status,
        lastUpdated: (marks[0] as { updatedAt?: Date } | undefined)?.updatedAt?.toISOString(),
      });
    }
    return out;
  },

  async getAuditLog(schoolId: string, examId: string) {
    const docs = await ExamAuditLogModel.find({ schoolId, examId }).sort({ createdAt: -1 }).limit(200).lean();
    return docs.map((d) => ({
      id: String(d._id),
      timestamp: d.timestamp,
      action: d.action,
      performedBy: d.performedBy,
      details: d.details,
    }));
  },
};
