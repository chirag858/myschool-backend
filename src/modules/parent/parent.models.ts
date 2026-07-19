import { Schema, model, type InferSchemaType } from 'mongoose';

/** A complaint/grievance raised by a parent about one of their children. */
const parentComplaintSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    studentId: { type: String, required: true, index: true },
    guardianUserId: { type: String, default: '' },
    subject: { type: String, required: true },
    category: { type: String, default: 'other' },
    description: { type: String, default: '' },
    submittedAt: { type: String, default: '' },
    status: { type: String, enum: ['submitted', 'in_review', 'in_progress', 'resolved'], default: 'submitted' },
    resolution: String,
  },
  { timestamps: true },
);
export type ParentComplaintDoc = InferSchemaType<typeof parentComplaintSchema>;
export const ParentComplaintModel = model('ParentComplaint', parentComplaintSchema);
