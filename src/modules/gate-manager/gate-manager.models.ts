import { Schema, model, type InferSchemaType } from 'mongoose';

const school = { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true } as const;

/** A student pickup/release handled at the gate. */
const pickupSchema = new Schema(
  {
    schoolId: school,
    studentId: { type: String, default: '' },
    studentName: { type: String, required: true },
    className: { type: String, default: '' },
    section: { type: String, default: '' },
    admissionNumber: { type: String, default: '' },
    pickupBy: { type: String, default: '' },
    relation: { type: String, default: 'other' },
    mobile: { type: String, default: '' },
    reason: { type: String, default: 'regular_dispersal' },
    proofPhotoUrl: String,
    verificationMethod: { type: String, default: 'photo_match' },
    inTime: { type: String, default: '' },
    outTime: String,
    approvedBy: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'verifying', 'passed_out', 'rejected'], default: 'passed_out' },
    notes: String,
  },
  { timestamps: true },
);

/** A visitor logged at the gate. */
const visitorSchema = new Schema(
  {
    schoolId: school,
    name: { type: String, required: true },
    mobile: { type: String, default: '' },
    purpose: { type: String, default: '' },
    whomToMeet: { type: String, default: '' },
    studentId: String,
    studentName: String,
    idRef: String,
    proofPhotoUrl: String,
    takingStudentHome: { type: Boolean, default: false },
    inTime: { type: String, default: '' },
    outTime: String,
    passNumber: { type: String, default: '' },
  },
  { timestamps: true },
);

/** A teacher's gate pass — staff stepping out during school hours. */
const teacherPassSchema = new Schema(
  {
    schoolId: school,
    teacherName: { type: String, required: true },
    duration: { type: String, default: '1_hour' },
    customDuration: String,
    reason: String,
    outTime: { type: String, default: '' },
    returnedAt: String,
    issuedBy: { type: String, default: '' },
  },
  { timestamps: true },
);

export type PickupDoc = InferSchemaType<typeof pickupSchema>;
export type VisitorDoc = InferSchemaType<typeof visitorSchema>;
export type TeacherPassDoc = InferSchemaType<typeof teacherPassSchema>;

export const PickupModel = model('GatePickup', pickupSchema);
export const VisitorModel = model('GateVisitor', visitorSchema);
export const TeacherPassModel = model('TeacherGatePass', teacherPassSchema);
