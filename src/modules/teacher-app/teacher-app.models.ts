import { Schema, model, type InferSchemaType } from 'mongoose';

const school = { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true } as const;

/** Teacher-authored content — homework / classwork / lesson plan (soft-deleted). */
const contentSchema = new Schema(
  {
    schoolId: school,
    teacherUserId: { type: String, required: true, index: true },
    type: { type: String, enum: ['homework', 'classwork', 'lessonPlan'], default: 'homework' },
    classSectionId: { type: String, default: '' },
    classSectionLabel: { type: String, default: '' },
    subject: String,
    title: { type: String, required: true },
    body: { type: String, default: '' },
    date: { type: String, default: '' },
    endDate: String,
    topic: String,
    objectives: String,
    attachments: { type: [Schema.Types.Mixed], default: [] },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

/** A markable assessment (components + workflow) the teacher enters raw marks for. */
const assessmentSchema = new Schema(
  {
    schoolId: school,
    name: { type: String, required: true },
    classSectionId: { type: String, default: '' },
    subject: String,
    workflowState: { type: String, enum: ['draft', 'submitted', 'published'], default: 'draft' },
    components: { type: [Schema.Types.Mixed], default: [] }, // [{key,label,max}]
    passPercent: { type: Number, default: 33 },
  },
  { timestamps: true },
);

/** One student's raw component marks for an assessment. */
const marksEntrySchema = new Schema(
  {
    schoolId: school,
    assessmentId: { type: String, required: true, index: true },
    studentId: { type: String, required: true },
    marks: { type: Schema.Types.Mixed, default: () => ({}) }, // { componentKey: number|null }
  },
  { timestamps: true },
);
marksEntrySchema.index({ assessmentId: 1, studentId: 1 }, { unique: true });

export type ContentDoc = InferSchemaType<typeof contentSchema>;
export type AssessmentDoc = InferSchemaType<typeof assessmentSchema>;
export const TeacherContentModel = model('TeacherContent', contentSchema);
export const AssessmentModel = model('MarksAssessment', assessmentSchema);
export const MarksEntryModel = model('MarksEntry', marksEntrySchema);
