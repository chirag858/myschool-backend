import { Schema, model, type InferSchemaType } from 'mongoose';

export const EXAM_TYPES = ['unit_test', 'monthly', 'mid_term', 'final', 'board', 'custom'] as const;
export const EXAM_STATUSES = ['scheduled', 'ongoing', 'marks_entry', 'results_pending', 'published', 'archived'] as const;

const examSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    name: { type: String, required: true },
    type: { type: String, enum: EXAM_TYPES, default: 'unit_test' },
    session: { type: String, default: '' },
    classes: { type: [String], default: [] },
    startDate: { type: String, default: '' },
    endDate: { type: String, default: '' },
    resultDate: { type: String, default: '' },
    description: String,
    status: { type: String, enum: EXAM_STATUSES, default: 'scheduled' },
    published: { type: Boolean, default: false },
    /** Record<classKey, ExamPattern> */
    patternByClass: { type: Schema.Types.Mixed, default: () => ({}) },
    dateSheet: { type: [Schema.Types.Mixed], default: [] },
    /** classKeys whose results are published. */
    publishedResults: { type: [String], default: [] },
  },
  { timestamps: true },
);
export type ExamDoc = InferSchemaType<typeof examSchema>;
export const ExamModel = model('Exam', examSchema);

// One mark row per (exam, subject, student).
const examMarkSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    examId: { type: Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },
    classKey: { type: String, required: true },
    subjectId: { type: String, required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    theory: { type: Number, default: null },
    practical: { type: Number, default: null },
    internal: { type: Number, default: null },
    isAbsent: { type: Boolean, default: false },
    remarks: String,
    submitted: { type: Boolean, default: false },
  },
  { timestamps: true },
);
examMarkSchema.index({ examId: 1, subjectId: 1, studentId: 1 }, { unique: true });
export type ExamMarkDoc = InferSchemaType<typeof examMarkSchema>;
export const ExamMarkModel = model('ExamMark', examMarkSchema);
