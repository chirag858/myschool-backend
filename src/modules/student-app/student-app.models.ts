import { Schema, model, type InferSchemaType } from 'mongoose';

/** Tracks which notices a student has marked read (notices come from circulars/announcements). */
const noticeReadSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    studentId: { type: String, required: true, index: true },
    noticeId: { type: String, required: true },
  },
  { timestamps: true },
);
noticeReadSchema.index({ studentId: 1, noticeId: 1 }, { unique: true });

export type NoticeReadDoc = InferSchemaType<typeof noticeReadSchema>;
export const NoticeReadModel = model('StudentNoticeRead', noticeReadSchema);
