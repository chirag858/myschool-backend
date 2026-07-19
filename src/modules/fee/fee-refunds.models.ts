import { Schema, model, type InferSchemaType } from 'mongoose';

/** A fee refund request (excess payment / cancelled service), with approval workflow. */
const refundRequestSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    studentId: { type: String, default: '' },
    studentName: { type: String, default: '' },
    className: { type: String, default: '' },
    amount: { type: Number, default: 0 },
    refundMode: { type: String, enum: ['cash', 'bank', 'online'], default: 'cash' },
    reference: String,
    reason: { type: String, default: '' },
    requestedAt: { type: String, default: '' },
    requestedBy: { type: String, default: '' },
    requestedById: { type: String, default: '', index: true },
    status: { type: String, enum: ['pending_approval', 'approved', 'rejected', 'processed'], default: 'pending_approval' },
    approvedBy: String,
    approvedAt: String,
    rejectedAt: String,
    rejectionReason: String,
  },
  { timestamps: true },
);

export type RefundRequestDoc = InferSchemaType<typeof refundRequestSchema>;
export const RefundRequestModel = model('FeeRefundRequest', refundRequestSchema);
