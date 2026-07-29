import { Schema, model, type InferSchemaType } from 'mongoose';

const school = { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true } as const;

export const OUTPASS_STATUSES = ['issued', 'returned', 'overdue', 'cancelled'] as const;

/** A temporary student out-pass — leaves during school hours, expected back by a time. */
const outPassSchema = new Schema(
  {
    schoolId: school,
    outPassNumber: { type: String, required: true },
    studentId: { type: String, required: true, index: true },
    studentName: { type: String, default: '' },
    studentPhoto: String,
    className: { type: String, default: '' },
    fatherName: { type: String, default: '' },
    fatherMobile: { type: String, default: '' },
    purpose: { type: String, default: '' },
    destination: { type: String, default: '' },
    issueTime: { type: String, default: '' },
    expectedReturn: { type: String, default: '' },
    actualReturn: String,
    issuedBy: { type: String, default: '' },
    parentApprovalRequired: { type: Boolean, default: false },
    otpVerified: { type: Boolean, default: false },
    remarks: String,
    status: { type: String, enum: OUTPASS_STATUSES, default: 'issued' },
  },
  { timestamps: true },
);

/** A visitor logged at the gate from the admin-side Visitor Management screen. */
const adminGateVisitorSchema = new Schema(
  {
    schoolId: school,
    visitorName: { type: String, required: true },
    mobile: { type: String, default: '' },
    idProofType: { type: String, default: 'aadhaar' },
    idProofNumber: { type: String, default: '' },
    personToMeet: { type: String, default: '' },
    purpose: { type: String, default: '' },
    department: String,
    roomNumber: String,
    checkInTime: { type: String, default: '' },
    checkOutTime: String,
    vehicleNumber: String,
    photoUrl: String,
  },
  { timestamps: true },
);

export type OutPassDoc = InferSchemaType<typeof outPassSchema>;
export type AdminGateVisitorDoc = InferSchemaType<typeof adminGateVisitorSchema>;

export const OutPassModel = model('OutPass', outPassSchema);
export const AdminGateVisitorModel = model('AdminGateVisitor', adminGateVisitorSchema);
