import { Schema, model, type InferSchemaType } from 'mongoose';

export const PROFILE_STATUSES = ['active', 'inactive', 'left', 'tc_issued', 'passed_out', 'suspended'] as const;
export const FEE_STATUSES = ['paid', 'partial', 'pending', 'advance'] as const;
export const ADMISSION_TYPES = ['new', 'old'] as const;
export const GENDERS = ['male', 'female', 'other'] as const;

const addressSchema = new Schema(
  { line1: String, line2: String, city: String, state: String, pinCode: String },
  { _id: false },
);

const parentsSchema = new Schema(
  {
    fatherName: { type: String, default: '' },
    fatherMobile: { type: String, default: '' },
    fatherOccupation: String,
    fatherEmail: String,
    fatherAadhaar: String,
    fatherPhotoUrl: String,
    motherName: String,
    motherMobile: String,
    motherOccupation: String,
    motherEmail: String,
    guardianName: String,
    guardianMobile: String,
    guardianRelation: String,
  },
  { _id: false },
);

const prevAcademicSchema = new Schema(
  { schoolName: String, className: String, board: String, tcNumber: String, reasonForLeaving: String },
  { _id: false },
);

const documentSchema = new Schema({
  type: { type: String, default: 'other' },
  customLabel: String,
  fileName: String,
  sizeBytes: { type: Number, default: 0 },
  uploadedAt: { type: String },
  verification: { type: String, enum: ['pending', 'verified'], default: 'pending' },
});

const studentSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    admissionNumber: { type: String, required: true },
    rollNumber: { type: String, default: '' },
    name: { type: String, required: true },
    fatherName: { type: String, default: '' },
    classId: { type: Schema.Types.ObjectId, ref: 'Class' },
    className: { type: String, default: '' },
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section' },
    section: { type: String, default: '' },
    classKey: { type: String, default: '', index: true },
    admissionType: { type: String, enum: ADMISSION_TYPES, default: 'new' },
    admittedAt: { type: Date, default: Date.now },
    feeStatus: { type: String, enum: FEE_STATUSES, default: 'pending' },
    profileStatus: { type: String, enum: PROFILE_STATUSES, default: 'active' },
    photoUrl: String,
    mobile: { type: String, default: '' },
    sessionLabel: { type: String, default: '' },
    dateOfBirth: { type: String, default: '' },
    gender: { type: String, enum: GENDERS, default: 'male' },
    bloodGroup: { type: String, default: 'O+' },
    religion: { type: String, default: 'hindu' },
    caste: String,
    category: { type: String, default: 'general' },
    nationality: { type: String, default: 'Indian' },
    aadhaar: String,
    parents: { type: parentsSchema, default: () => ({}) },
    currentAddress: { type: addressSchema, default: () => ({}) },
    permanentAddress: { type: addressSchema, default: () => ({}) },
    permanentSameAsCurrent: { type: Boolean, default: true },
    previousAcademic: { type: prevAcademicSchema, default: undefined },
    documents: { type: [documentSchema], default: [] },
  },
  { timestamps: true },
);

studentSchema.index({ schoolId: 1, admissionNumber: 1 }, { unique: true });

export type StudentDoc = InferSchemaType<typeof studentSchema>;
export const StudentModel = model('Student', studentSchema);
