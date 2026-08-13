import { Schema, model, type InferSchemaType } from 'mongoose';

export const INSTALLMENT_FREQUENCIES = ['monthly', 'quarterly', 'custom'] as const;
export const INSTALLMENT_STATUSES = ['on_track', 'due_soon', 'overdue', 'completed'] as const;
export const SCHEDULE_ENTRY_STATUSES = ['paid', 'due', 'upcoming'] as const;
export const REMINDER_TRIGGER_KINDS = ['before_due', 'on_due', 'after_due', 'every_n_days_overdue'] as const;
export const REMINDER_CHANNELS = ['sms', 'whatsapp', 'both'] as const;
export const REMINDER_AUDIENCES = ['all_dues', 'specific_classes', 'above_threshold'] as const;

const scheduleEntrySchema = new Schema(
  {
    index: { type: Number, required: true },
    dueDate: { type: String, required: true },
    amount: { type: Number, required: true },
    status: { type: String, enum: SCHEDULE_ENTRY_STATUSES, default: 'upcoming' },
    receiptNumber: String,
    paidOn: String,
  },
  { _id: false },
);

// ── Installment Plan (master) ──────────────────────────────────────
const installmentPlanSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    name: { type: String, required: true },
    installmentsCount: { type: Number, required: true },
    frequency: { type: String, enum: INSTALLMENT_FREQUENCIES, default: 'monthly' },
    customDates: { type: [String], default: [] },
    applicableFeeHeads: { type: [String], default: [] },
    processingFee: { type: Number, default: 0 },
    latePaymentFinePerDay: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
export type InstallmentPlanDoc = InferSchemaType<typeof installmentPlanSchema>;
export const InstallmentPlanModel = model('InstallmentPlan', installmentPlanSchema);

// ── Student Installment (assignment) ───────────────────────────────
const studentInstallmentSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    studentName: { type: String, default: '' },
    className: { type: String, default: '' },
    planId: { type: String, required: true },
    planName: { type: String, default: '' },
    totalAmount: { type: Number, default: 0 },
    paidAmount: { type: Number, default: 0 },
    remainingAmount: { type: Number, default: 0 },
    nextDueDate: String,
    nextInstallmentAmount: Number,
    status: { type: String, enum: INSTALLMENT_STATUSES, default: 'on_track' },
    schedule: { type: [scheduleEntrySchema], default: [] },
  },
  { timestamps: true },
);
export type StudentInstallmentDoc = InferSchemaType<typeof studentInstallmentSchema>;
export const StudentInstallmentModel = model('StudentInstallment', studentInstallmentSchema);

// ── Reminder Rule ───────────────────────────────────────────────────
const reminderRuleSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    name: { type: String, required: true },
    trigger: {
      kind: { type: String, enum: REMINDER_TRIGGER_KINDS, required: true },
      days: Number,
    },
    channel: { type: String, enum: REMINDER_CHANNELS, default: 'sms' },
    templateId: { type: String, default: '' },
    audience: { type: String, enum: REMINDER_AUDIENCES, default: 'all_dues' },
    audienceClassKeys: { type: [String], default: [] },
    audienceMinAmount: Number,
    active: { type: Boolean, default: true },
    lastRunAt: String,
  },
  { timestamps: true },
);
export type ReminderRuleDoc = InferSchemaType<typeof reminderRuleSchema>;
export const ReminderRuleModel = model('ReminderRule', reminderRuleSchema);

// ── Reminder Log ────────────────────────────────────────────────────
const reminderLogSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    ruleId: { type: String, default: 'manual' },
    ruleName: { type: String, default: 'Manual reminder' },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', index: true },
    studentName: { type: String, default: '' },
    className: { type: String, default: '' },
    amountDue: { type: Number, default: 0 },
    channel: { type: String, enum: REMINDER_CHANNELS, default: 'sms' },
    status: { type: String, enum: ['sent', 'failed'], default: 'sent' },
    messagePreview: { type: String, default: '' },
    sentAt: { type: String, required: true },
  },
  { timestamps: true },
);
export type ReminderLogDoc = InferSchemaType<typeof reminderLogSchema>;
export const ReminderLogModel = model('ReminderLog', reminderLogSchema);

// ── Sibling Group ───────────────────────────────────────────────────
const siblingGroupSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    parentName: { type: String, default: '' },
    parentMobile: { type: String, required: true },
    children: {
      type: [
        new Schema(
          { studentId: String, studentName: String, className: String, admissionNumber: String },
          { _id: false },
        ),
      ],
      default: [],
    },
    discountApplied: { type: Boolean, default: false },
  },
  { timestamps: true },
);
siblingGroupSchema.index({ schoolId: 1, parentMobile: 1 }, { unique: true });
export type SiblingGroupDoc = InferSchemaType<typeof siblingGroupSchema>;
export const SiblingGroupModel = model('SiblingGroup', siblingGroupSchema);
