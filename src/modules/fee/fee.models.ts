import { Schema, model, type InferSchemaType } from 'mongoose';

export const FEE_FREQUENCIES = ['monthly', 'quarterly', 'half_yearly', 'yearly', 'one_time'] as const;
export const RECEIPT_STATUSES = ['active', 'cancelled', 'duplicate_issued', 'reversed'] as const;

/** Months per year each frequency bills. */
export const FREQUENCY_MULTIPLIER: Record<string, number> = {
  monthly: 12,
  quarterly: 4,
  half_yearly: 2,
  yearly: 1,
  one_time: 1,
};

// ── Fee Head ──────────────────────────────────────────────────────
const feeHeadSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    name: { type: String, required: true },
    type: { type: String, default: 'custom' },
    description: String,
    isRefundable: { type: Boolean, default: false },
    isMandatory: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);
export type FeeHeadDoc = InferSchemaType<typeof feeHeadSchema>;
export const FeeHeadModel = model('FeeHead', feeHeadSchema);

// ── Fee Structure row (per session, per fee head) ─────────────────
const feeStructureSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    session: { type: String, required: true },
    feeHeadId: { type: String, required: true },
    frequency: { type: String, enum: FEE_FREQUENCIES, default: 'monthly' },
    /** Record<className, amount>. */
    amounts: { type: Schema.Types.Mixed, default: () => ({}) },
  },
  { timestamps: true },
);
feeStructureSchema.index({ schoolId: 1, session: 1, feeHeadId: 1 }, { unique: true });
export type FeeStructureDoc = InferSchemaType<typeof feeStructureSchema>;
export const FeeStructureModel = model('FeeStructure', feeStructureSchema);

// ── Receipt ───────────────────────────────────────────────────────
const receiptSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    receiptNumber: { type: String, required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', index: true },
    studentName: { type: String, default: '' },
    className: { type: String, default: '' },
    section: { type: String, default: '' },
    monthsCovered: { type: [String], default: [] },
    /** How this receipt's `amount` splits across `monthsCovered` — a receipt spanning several months
     * must not count its full amount against each one (that would let a partial multi-month payment
     * show every covered month as fully paid). Empty on legacy receipts; readers fall back to an
     * even split across `monthsCovered` for those. */
    monthAllocations: { type: [new Schema({ month: String, amount: Number }, { _id: false })], default: [] },
    feeHeads: { type: [new Schema({ name: String, amount: Number }, { _id: false })], default: [] },
    amount: { type: Number, default: 0 },
    paymentMode: { type: String, default: 'cash' },
    payments: { type: [Schema.Types.Mixed], default: [] },
    waiveOff: { type: new Schema({ amount: Number, reason: String }, { _id: false }), default: undefined },
    paymentDate: { type: String, default: '' },
    generatedBy: { type: String, default: 'System' },
    status: { type: String, enum: RECEIPT_STATUSES, default: 'active' },
    cancelledReason: String,
    cancelledBy: String,
    cancelledAt: String,
    /** Set once this receipt has been reversed by a credit-note receipt — blocks a second cancel/duplicate/reverse even though `status` stays 'active' for sum purposes. */
    reversedAt: String,
    /** AppliedFine ids this receipt settled — restored to 'pending' on cancel/reverse. */
    fineIds: { type: [Schema.Types.ObjectId], default: [] },
    remarks: String,
  },
  { timestamps: true },
);
receiptSchema.index({ schoolId: 1, receiptNumber: 1 }, { unique: true });
export type ReceiptDoc = InferSchemaType<typeof receiptSchema>;
export const ReceiptModel = model('Receipt', receiptSchema);
