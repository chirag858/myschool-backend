import { Schema, model, type InferSchemaType } from 'mongoose';

export const SESSION_STATUSES = ['active', 'upcoming', 'closed', 'archived'] as const;
export const HOLIDAY_APPLICABILITY = ['all', 'students_only', 'staff_only', 'specific_classes'] as const;

// ── Academic Session ──────────────────────────────────────────────
const sessionSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    name: { type: String, required: true },
    startDate: { type: String, required: true },
    endDate: { type: String, required: true },
    status: { type: String, enum: SESSION_STATUSES, default: 'upcoming', index: true },
    description: String,
    createdBy: { type: String, default: 'System' },
    copiedFromSessionId: String,
  },
  { timestamps: true },
);
export type SessionDoc = InferSchemaType<typeof sessionSchema>;
export const SessionModel = model('AcademicSession', sessionSchema);

// ── Class ─────────────────────────────────────────────────────────
const classSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    name: { type: String, required: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);
classSchema.index({ schoolId: 1, name: 1 }, { unique: true });
export type ClassDoc = InferSchemaType<typeof classSchema>;
export const ClassModel = model('Class', classSchema);

// ── Section ───────────────────────────────────────────────────────
const sectionSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    classId: { type: Schema.Types.ObjectId, ref: 'Class', required: true, index: true },
    name: { type: String, required: true },
    classTeacherId: { type: String, default: null },
    classTeacherName: { type: String, default: null },
    roomId: { type: String, default: null },
    roomName: { type: String, default: null },
    maxCapacity: { type: Number, default: 40 },
  },
  { timestamps: true },
);
export type SectionDoc = InferSchemaType<typeof sectionSchema>;
export const SectionModel = model('Section', sectionSchema);

// ── Holiday ───────────────────────────────────────────────────────
const holidaySchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    sessionId: { type: Schema.Types.ObjectId, ref: 'AcademicSession', index: true },
    name: { type: String, required: true },
    startDate: { type: String, required: true },
    endDate: { type: String, required: true },
    type: { type: String, default: 'public' },
    applicability: { type: String, enum: HOLIDAY_APPLICABILITY, default: 'all' },
    applicableClasses: { type: [String], default: [] },
    recurring: { type: Boolean, default: false },
    description: String,
  },
  { timestamps: true },
);
export type HolidayDoc = InferSchemaType<typeof holidaySchema>;
export const HolidayModel = model('Holiday', holidaySchema);
