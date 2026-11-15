import { Schema, model, type InferSchemaType } from 'mongoose';

const school = { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true } as const;

/**
 * A syllabus document a teacher / school admin uploads for a class. Parents of
 * that class open or download it. `classKey` is `${className}-${section}` (same
 * shape as parent-app `classKeyOf`). One row per uploaded file.
 */
const syllabusSchema = new Schema(
  {
    schoolId: school,
    title: { type: String, required: true },
    classKey: { type: String, required: true, index: true },
    subject: { type: String, default: '' },
    term: { type: String, default: '' },
    fileUrl: { type: String, required: true },
    fileName: { type: String, default: '' },
    fileKey: { type: String, default: '' },
    createdById: { type: String, default: '' },
    createdBy: { type: String, default: '' },
  },
  { timestamps: true },
);
syllabusSchema.index({ schoolId: 1, classKey: 1, createdAt: -1 });

export type SyllabusDoc = InferSchemaType<typeof syllabusSchema>;
export const SyllabusModel = model('SyllabusDoc', syllabusSchema);
