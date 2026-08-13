import { Schema, model, type InferSchemaType } from 'mongoose';

const staffSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    employeeId: { type: String, required: true },
    name: { type: String, required: true },
    designation: { type: String, default: '' },
    designationLabel: { type: String, default: '' },
    department: { type: String, default: '' },
    departmentLabel: { type: String, default: '' },
    employmentType: { type: String, default: 'full_time' },
    status: { type: String, default: 'active' },
    mobile: { type: String, default: '' },
    email: String,
    joiningDate: { type: String, default: '' },
    photoUrl: String,
    basic: { type: Number, default: 0 },
    netSalary: { type: Number, default: 0 },
    /** teaching | non_teaching — drives stats. */
    category: { type: String, default: 'non_teaching' },
    // Profile extras (optional / free-form).
    dateOfBirth: String,
    gender: String,
    bloodGroup: String,
    religion: String,
    caste: String,
    nationality: String,
    aadhaar: String,
    pan: String,
    emergencyContactName: String,
    emergencyContactMobile: String,
    personalEmail: String,
    currentAddress: { type: Schema.Types.Mixed, default: () => ({}) },
    permanentAddress: { type: Schema.Types.Mixed, default: () => ({}) },
    permanentSameAsCurrent: { type: Boolean, default: true },
    reportingToId: String,
    reportingToName: String,
    probationEndDate: String,
    workingHoursPerDay: { type: Number, default: 8 },
    weeklyOffDays: { type: [String], default: ['sun'] },
    qualifications: { type: [Schema.Types.Mixed], default: [] },
    experience: { type: [Schema.Types.Mixed], default: [] },
    teachingSubjects: { type: [String], default: [] },
    teachingClasses: { type: [String], default: [] },
    teachingExperienceYears: Number,
    salaryStructure: { type: Schema.Types.Mixed, default: () => ({}) },
    salaryRevisions: { type: [Schema.Types.Mixed], default: [] },
  },
  { timestamps: true },
);
staffSchema.index({ schoolId: 1, employeeId: 1 }, { unique: true });
export type StaffDoc = InferSchemaType<typeof staffSchema>;
export const StaffModel = model('Staff', staffSchema);

const staffAttendanceSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    staffId: { type: String, required: true },
    date: { type: String, required: true },
    status: { type: String, enum: ['present', 'absent', 'leave', 'half_day', 'late'], required: true },
    timeIn: String,
    timeOut: String,
    remarks: String,
  },
  { timestamps: true },
);
staffAttendanceSchema.index({ schoolId: 1, staffId: 1, date: 1 }, { unique: true });
staffAttendanceSchema.index({ schoolId: 1, date: 1 });
export type StaffAttendanceDoc = InferSchemaType<typeof staffAttendanceSchema>;
export const StaffAttendanceModel = model('StaffAttendance', staffAttendanceSchema);

const lockSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    date: { type: String, required: true },
    locked: { type: Boolean, default: true },
  },
  { timestamps: true },
);
lockSchema.index({ schoolId: 1, date: 1 }, { unique: true });
export type LockDoc = InferSchemaType<typeof lockSchema>;
export const StaffAttendanceLockModel = model('StaffAttendanceLock', lockSchema);
