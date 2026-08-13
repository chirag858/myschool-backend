import { Schema, model, type InferSchemaType } from 'mongoose';

/** Immutable correction/audit record for the Utilize module. Never edited in place — status transitions only. */
const correctionSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', index: true },
    timestamp: { type: String, default: '' },
    operator: { type: String, default: '' },
    role: { type: String, default: '' },
    category: { type: String, enum: ['receipt', 'readjustment'], required: true },
    action: { type: String, required: true },
    recordRef: { type: String, default: '' },
    /** Real Mongo _id of the record being corrected — recordRef is a human-readable label, this is what a later approve() actually mutates. */
    targetId: { type: String, default: '' },
    studentId: { type: String, default: '' },
    studentName: { type: String, default: '' },
    oldValue: { type: Schema.Types.Mixed, default: null },
    newValue: { type: Schema.Types.Mixed, default: null },
    reasonCode: { type: String, default: 'other' },
    reason: { type: String, default: '' },
    status: { type: String, enum: ['applied', 'pending_approval', 'approved', 'rejected'], default: 'pending_approval' },
    requestedBy: { type: String, default: '' },
    approvedBy: String,
    approvedAt: String,
    rejectedReason: String,
    ipAddress: { type: String, default: '' },
  },
  { timestamps: true },
);

export type CorrectionDoc = InferSchemaType<typeof correctionSchema>;
export const CorrectionModel = model('UtilizeCorrection', correctionSchema);
