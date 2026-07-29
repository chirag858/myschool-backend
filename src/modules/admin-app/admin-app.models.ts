import { Schema, model, type InferSchemaType } from 'mongoose';

/** A management approval item with a multi-level decision trail. */
const approvalSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    type: {
      type: String,
      enum: ['admission', 'concession', 'refund', 'leave', 'salarySlip', 'resignation'],
      required: true,
    },
    title: { type: String, default: '' },
    subtitle: { type: String, default: '' },
    currentLevel: { type: Number, default: 1 },
    maxLevel: { type: Number, default: 2 },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    amount: Number,
    fields: { type: [Schema.Types.Mixed], default: [] },
    trail: { type: [Schema.Types.Mixed], default: [] },
    createdAt: { type: String, default: '' },
  },
  { timestamps: false },
);

export type ApprovalDoc = InferSchemaType<typeof approvalSchema>;
export const ApprovalModel = model('ManagementApproval', approvalSchema);
