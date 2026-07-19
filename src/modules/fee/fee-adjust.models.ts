import { Schema, model, type InferSchemaType } from 'mongoose';

const school = { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true } as const;

/** A fee readjustment audit record (previous-fee / advance / transfer / bulk / refund). */
const readjustmentSchema = new Schema(
  {
    schoolId: school,
    type: { type: String, default: 'previous_fee' },
    date: { type: String, default: '' },
    studentName: String,
    targetStudentName: String,
    className: String,
    oldValue: { type: String, default: '' },
    newValue: { type: String, default: '' },
    difference: { type: String, default: '' },
    reason: { type: String, default: '' },
    performedBy: { type: String, default: 'System' },
    ipAddress: { type: String, default: '' },
  },
  { timestamps: true },
);

/** A fee waive-off request/record (forgives actual dues, with approval above a threshold). */
const waiveOffSchema = new Schema(
  {
    schoolId: school,
    studentId: { type: String, default: '' },
    studentName: { type: String, default: '' },
    className: { type: String, default: '' },
    type: { type: String, default: 'partial' },
    heads: { type: [String], default: [] },
    amount: { type: Number, default: 0 },
    reasonCode: { type: String, default: 'other' },
    reason: { type: String, default: '' },
    requestedBy: { type: String, default: 'System' },
    requestedAt: { type: String, default: '' },
    status: { type: String, enum: ['pending_approval', 'approved', 'rejected', 'applied'], default: 'pending_approval' },
    approvedBy: String,
    approvedAt: String,
    appliedAt: String,
    rejectedReason: String,
    reference: String,
    ipAddress: { type: String, default: '' },
  },
  { timestamps: true },
);

export type ReadjustmentDoc = InferSchemaType<typeof readjustmentSchema>;
export type WaiveOffDoc = InferSchemaType<typeof waiveOffSchema>;
export const ReadjustmentModel = model('FeeReadjustment', readjustmentSchema);
export const WaiveOffModel = model('FeeWaiveOff', waiveOffSchema);
