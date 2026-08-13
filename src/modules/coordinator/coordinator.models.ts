import { Schema, model, type InferSchemaType } from 'mongoose';

const studentLeaveSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    studentId: String,
    studentName: { type: String, required: true },
    className: { type: String, default: '' },
    fatherName: { type: String, default: '' },
    fatherMobile: { type: String, default: '' },
    fromDate: { type: String, default: '' },
    toDate: { type: String, default: '' },
    days: { type: Number, default: 1 },
    type: { type: String, default: 'other' },
    reason: { type: String, default: '' },
    appliedOn: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'forwarded'], default: 'pending' },
    remarks: String,
    rejectionReason: String,
    decidedAt: String,
    decidedBy: String,
  },
  { timestamps: true },
);
export type StudentLeaveDoc = InferSchemaType<typeof studentLeaveSchema>;
export const StudentLeaveModel = model('StudentLeave', studentLeaveSchema);

/** A staff leave request flowing through the multi-level approval chain. */
const staffLeaveSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    staffId: { type: String, default: '' },
    staffName: { type: String, required: true },
    designation: { type: String, default: '' },
    department: { type: String, default: '' },
    type: { type: String, default: 'casual' },
    fromDate: { type: String, default: '' },
    toDate: { type: String, default: '' },
    days: { type: Number, default: 1 },
    reason: { type: String, default: '' },
    substitute: String,
    appliedOn: { type: String, default: '' },
    // 1 = coordinator queue, 2 = principal, 3 = admin.
    currentLevel: { type: Number, enum: [1, 2, 3], default: 1 },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    balanceForType: Number,
    remarks: String,
    rejectionReason: String,
    decidedAt: String,
  },
  { timestamps: true },
);
staffLeaveSchema.index({ schoolId: 1, currentLevel: 1, status: 1 });
export type StaffLeaveDoc = InferSchemaType<typeof staffLeaveSchema>;
export const StaffLeaveModel = model('CoordinatorStaffLeave', staffLeaveSchema);
