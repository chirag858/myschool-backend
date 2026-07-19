import { Schema, model, type InferSchemaType } from 'mongoose';

const fineRuleSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    name: { type: String, required: true },
    applicableAfterDays: { type: Number, default: 0 },
    type: { type: String, default: 'fixed' },
    value: { type: Number, default: 0 },
    applicableFeeHeads: { type: [String], default: [] },
    applicableClasses: { type: Schema.Types.Mixed, default: 'all' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
export type FineRuleDoc = InferSchemaType<typeof fineRuleSchema>;
export const FineRuleModel = model('FineRule', fineRuleSchema);

const appliedFineSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    studentId: String,
    studentName: String,
    className: String,
    fineRuleId: String,
    fineRuleName: String,
    month: String,
    amount: { type: Number, default: 0 },
    appliedAt: String,
    status: { type: String, enum: ['pending', 'paid', 'waived'], default: 'pending' },
    waivedBy: String,
    waivedReason: String,
    waivedAt: String,
  },
  { timestamps: true },
);
export type AppliedFineDoc = InferSchemaType<typeof appliedFineSchema>;
export const AppliedFineModel = model('AppliedFine', appliedFineSchema);

const concessionSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    code: { type: String, default: '' },
    name: { type: String, required: true },
    category: { type: String, default: 'custom' },
    subType: String,
    calcType: { type: String, default: 'flat' },
    value: { type: Number, default: 0 },
    targetFeeHeads: { type: [String], default: [] },
    applicableClasses: { type: Schema.Types.Mixed, default: 'all' },
    requiresApproval: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
export type ConcessionDoc = InferSchemaType<typeof concessionSchema>;
export const ConcessionModel = model('Concession', concessionSchema);

const appliedConcessionSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    studentId: String,
    studentName: String,
    className: String,
    concessionId: String,
    concessionName: String,
    category: String,
    value: { type: Number, default: 0 },
    calcType: String,
    appliedToHeads: { type: [String], default: [] },
    appliedBy: String,
    approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected', 'active', 'revoked'], default: 'active' },
    effectiveFrom: String,
  },
  { timestamps: true },
);
export type AppliedConcessionDoc = InferSchemaType<typeof appliedConcessionSchema>;
export const AppliedConcessionModel = model('AppliedConcession', appliedConcessionSchema);

const approvalSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    appliedConcessionId: String,
    studentName: String,
    className: String,
    concessionName: String,
    concessionCategory: String,
    requestedBy: String,
    requestedAt: String,
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    currentLevel: { type: Number, default: 1 },
    history: { type: [Schema.Types.Mixed], default: [] },
  },
  { timestamps: true },
);
export type ApprovalDoc = InferSchemaType<typeof approvalSchema>;
export const ConcessionApprovalModel = model('ConcessionApproval', approvalSchema);
