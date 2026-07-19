import { Schema, model, type InferSchemaType } from 'mongoose';

export const ATTENDANCE_STATUSES = ['present', 'absent', 'leave', 'half_day', 'late'] as const;
export const LEAVE_TYPES = ['sick', 'casual', 'family', 'other'] as const;

// One record per student per day (day-precision date string 'YYYY-MM-DD').
const attendanceSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    date: { type: String, required: true },
    status: { type: String, enum: ATTENDANCE_STATUSES, required: true },
    time: String,
    remarks: String,
    leaveType: { type: String, enum: LEAVE_TYPES },
    className: { type: String, default: '' },
    section: { type: String, default: '' },
    markedBy: { type: String, default: 'System' },
  },
  { timestamps: true },
);
attendanceSchema.index({ schoolId: 1, studentId: 1, date: 1 }, { unique: true });
attendanceSchema.index({ schoolId: 1, className: 1, section: 1, date: 1 });
attendanceSchema.index({ schoolId: 1, date: 1 });

export type AttendanceDoc = InferSchemaType<typeof attendanceSchema>;
export const AttendanceModel = model('AttendanceRecord', attendanceSchema);

// Audit trail for post-lock overrides.
const overrideSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    date: { type: String, required: true },
    classLabel: { type: String, default: '' },
    studentName: { type: String, default: '' },
    originalStatus: { type: String, required: true },
    newStatus: { type: String, required: true },
    reason: { type: String, default: '' },
    overrideBy: { type: String, default: 'System' },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
export type OverrideDoc = InferSchemaType<typeof overrideSchema>;
export const OverrideModel = model('AttendanceOverride', overrideSchema);
