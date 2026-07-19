import { Schema, model, type InferSchemaType } from 'mongoose';

export const SCHOOL_STATUSES = ['active', 'expired', 'trial', 'suspended', 'pending_setup'] as const;
export const SUBSCRIPTION_PLANS = ['monthly', 'quarterly', 'half_yearly', 'yearly'] as const;
export const SCHOOL_TYPES = ['primary', 'secondary', 'senior_secondary', 'k12'] as const;
export const AFFILIATED_BOARDS = ['pseb', 'cbse', 'icse', 'state', 'custom'] as const;
export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'online'] as const;

/** Super-admin per-school module switches (Record<ModuleKey, boolean>). */
export const MODULE_KEYS = [
  'student_mgmt', 'fee_mgmt', 'attendance', 'timetable', 'examinations',
  'transport', 'hostel', 'library', 'inventory', 'payroll', 'communication',
  'parent_app', 'teacher_app', 'student_app', 'driver_app', 'online_payment',
  'whatsapp', 'sms', 'email',
] as const;

const brandingSchema = new Schema(
  {
    logoUrl: String,
    signatureUrl: String,
    stampUrl: String,
    headerText: String,
    footerText: String,
    primaryColor: String,
  },
  { _id: false },
);

const subscriptionSchema = new Schema(
  {
    id: { type: String, required: true },
    plan: { type: String, enum: SUBSCRIPTION_PLANS, required: true },
    startDate: String,
    endDate: String,
    graceDays: { type: Number, default: 0 },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, default: 'cash' },
    paymentReference: { type: String, default: '' },
    amountPaid: { type: Number, default: 0 },
    notes: String,
    status: { type: String, enum: ['active', 'expired', 'pending'], default: 'active' },
    addedBy: { type: String, default: 'System' },
    createdAt: { type: String },
  },
  { _id: false },
);

const schoolSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    type: { type: String, enum: SCHOOL_TYPES, default: 'k12' },
    board: { type: String, enum: AFFILIATED_BOARDS, default: 'cbse' },
    addressLine1: { type: String, default: '' },
    addressLine2: String,
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    pinCode: { type: String, default: '' },
    contactMobile: { type: String, default: '' },
    contactEmail: { type: String, default: '' },
    principalName: { type: String, default: '' },
    establishedYear: { type: Number, default: 2000 },
    status: { type: String, enum: SCHOOL_STATUSES, default: 'active', index: true },
    plan: { type: String, enum: SUBSCRIPTION_PLANS, default: 'yearly' },
    expiryDate: { type: String, default: '' },
    logoUrl: String,
    active: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
    branding: { type: brandingSchema, default: () => ({}) },
    subscription: { type: subscriptionSchema, default: null },
    /** Record<ModuleKey, boolean>; unset → treated as all-enabled. */
    moduleFlags: { type: Schema.Types.Mixed, default: undefined },
    /** Legacy gating list (module name strings) — kept for future use. */
    modules: { type: [String], default: [] },
  },
  { timestamps: true },
);

schoolSchema.set('toJSON', {
  virtuals: true,
  transform(_doc, ret: Record<string, unknown>) {
    ret._id = String(ret._id);
    delete ret.__v;
    return ret;
  },
});

export type SchoolDoc = InferSchemaType<typeof schoolSchema>;
export const SchoolModel = model('School', schoolSchema);
