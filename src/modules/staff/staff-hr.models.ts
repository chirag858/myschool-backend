import { Schema, model, type InferSchemaType } from 'mongoose';

const school = { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true } as const;

/** A staff leave application flowing through the multi-level approval chain. */
const leaveSchema = new Schema(
  {
    schoolId: school,
    staffId: { type: String, required: true, index: true },
    type: { type: String, default: 'casual' },
    fromDate: { type: String, default: '' },
    toDate: { type: String, default: '' },
    days: { type: Number, default: 1 },
    reason: { type: String, default: '' },
    substituteTeacherName: String,
    appliedOn: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending' },
    currentLevel: { type: Number, enum: [1, 2, 3], default: 1 },
    history: { type: [Schema.Types.Mixed], default: [] },
  },
  { timestamps: true },
);

// Salary structure + revisions live on the embedded StaffModel fields
// (staff.salaryStructure / staff.salaryRevisions), so getProfile reflects them.

/** A stored/generated HR document for a staff member. */
const documentSchema = new Schema(
  {
    schoolId: school,
    staffId: { type: String, required: true, index: true },
    category: { type: String, default: 'other' },
    fileName: { type: String, default: '' },
    sizeBytes: { type: Number, default: 0 },
    referenceNumber: String,
    uploadedAt: { type: String, default: '' },
    uploadedBy: { type: String, default: 'Admin' },
  },
  { timestamps: true },
);

/** An audit-trail entry for a staff member's HR record. */
const activitySchema = new Schema(
  {
    schoolId: school,
    staffId: { type: String, required: true, index: true },
    timestamp: { type: String, default: '' },
    action: { type: String, default: '' },
    performedBy: { type: String, default: '' },
    module: { type: String, default: '' },
    details: String,
  },
  { timestamps: true },
);

/** A monthly payroll slip for one staff member. */
const payrollSlipSchema = new Schema(
  {
    schoolId: school,
    staffId: { type: String, required: true, index: true },
    employeeId: { type: String, default: '' },
    name: { type: String, default: '' },
    designation: { type: String, default: '' },
    month: { type: String, required: true },
    year: { type: Number, required: true },
    basic: { type: Number, default: 0 },
    allowances: { type: Number, default: 0 },
    gross: { type: Number, default: 0 },
    absentDeduction: { type: Number, default: 0 },
    otherDeductions: { type: Number, default: 0 },
    netPayable: { type: Number, default: 0 },
    status: { type: String, enum: ['paid', 'pending', 'on_hold', 'advance_adjusted'], default: 'pending' },
    paymentDate: String,
    paymentMode: String,
    reference: String,
    holdReason: String,
  },
  { timestamps: true },
);
payrollSlipSchema.index({ schoolId: 1, staffId: 1, month: 1, year: 1 }, { unique: true });

/** A salary-advance request + its recovery schedule once approved. */
const advanceSchema = new Schema(
  {
    schoolId: school,
    staffId: { type: String, default: '' },
    staffName: { type: String, default: '' },
    amountRequested: { type: Number, default: 0 },
    reason: { type: String, default: '' },
    requestDate: { type: String, default: '' },
    repaymentMonths: { type: Number, default: 1 },
    monthlyRecovery: { type: Number, default: 0 },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    // Recovery tracking once approved.
    recoveredSoFar: { type: Number, default: 0 },
    activeStatus: { type: String, enum: ['active', 'completed'], default: 'active' },
  },
  { timestamps: true },
);

/** A staff exit / full-and-final record. */
const exitSchema = new Schema(
  {
    schoolId: school,
    staffId: { type: String, required: true, index: true },
    staffName: { type: String, default: '' },
    exitType: { type: String, default: 'resignation' },
    lastWorkingDate: { type: String, default: '' },
    noticePeriodDays: { type: Number, default: 0 },
    reason: { type: String, default: '' },
    handoverNotes: String,
    settlementAmount: Number,
    clearanceItems: { type: [Schema.Types.Mixed], default: [] },
    remarks: String,
    createdAt: { type: String, default: '' },
    createdBy: { type: String, default: 'Admin' },
  },
  { timestamps: false },
);

export type StaffLeaveDoc = InferSchemaType<typeof leaveSchema>;
export const StaffLeaveApplicationModel = model('StaffLeaveApplication', leaveSchema);
export const StaffDocumentModel = model('StaffHRDocument', documentSchema);
export const StaffActivityModel = model('StaffActivityLog', activitySchema);
export const PayrollSlipModel = model('PayrollSlip', payrollSlipSchema);
export const SalaryAdvanceModel = model('SalaryAdvance', advanceSchema);
export const StaffExitModel = model('StaffExitRecord', exitSchema);
