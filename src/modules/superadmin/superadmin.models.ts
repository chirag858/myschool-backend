import { Schema, model, type InferSchemaType } from 'mongoose';

/** Subscription history — one row per renewal for a school. */
const subscriptionSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    plan: { type: String, default: 'yearly' },
    startDate: { type: String, default: '' },
    endDate: { type: String, default: '' },
    graceDays: { type: Number, default: 0 },
    paymentMethod: { type: String, default: 'cash' },
    paymentReference: { type: String, default: '' },
    amountPaid: { type: Number, default: 0 },
    notes: String,
    status: { type: String, enum: ['active', 'expired', 'pending'], default: 'active' },
    addedBy: { type: String, default: 'Super Admin' },
    createdAt: { type: String, default: '' },
  },
  { timestamps: false },
);

/** Platform / per-school audit log entry. */
const auditLogSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', index: true },
    timestamp: { type: String, default: '' },
    actorName: { type: String, default: '' },
    actorRole: { type: String, default: '' },
    action: { type: String, default: '' },
    module: { type: String, default: '' },
    status: { type: String, enum: ['success', 'failure', 'pending'], default: 'success' },
    ipAddress: String,
  },
  { timestamps: true },
);

const ticketAttachmentSchema = new Schema(
  { fileName: String, fileSize: Number },
  { _id: true },
);

const ticketCommentSchema = new Schema(
  {
    authorId: { type: String, default: '' },
    authorName: { type: String, default: '' },
    authorRole: { type: String, default: '' },
    body: { type: String, default: '' },
    createdAt: { type: String, default: '' },
    attachments: { type: [ticketAttachmentSchema], default: [] },
    internal: { type: Boolean, default: false },
  },
  { _id: true },
);

const ticketActivitySchema = new Schema(
  {
    createdAt: { type: String, default: '' },
    performedBy: { type: String, default: '' },
    action: { type: String, default: '' },
  },
  { _id: true },
);

/** Support ticket, full model (board, detail, comments, activity). */
const ticketSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', index: true },
    ticketNumber: { type: String, default: '' },
    subject: { type: String, default: '' }, // legacy alias for title, kept for back-compat
    title: { type: String, default: '' },
    description: { type: String, default: '' },
    category: { type: String, default: 'other' },
    priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
    status: {
      type: String,
      enum: ['open', 'in_progress', 'testing', 'resolved', 'closed'],
      default: 'open',
      index: true,
    },
    reporterName: { type: String, default: '' },
    reporterRole: { type: String, default: '' },
    schoolName: { type: String, default: '' },
    assignedTo: { type: String, default: 'Unassigned' },
    resolvedAt: { type: String, default: '' },
    stepsToReproduce: { type: String, default: '' },
    attachments: { type: [ticketAttachmentSchema], default: [] },
    comments: { type: [ticketCommentSchema], default: [] },
    activity: { type: [ticketActivitySchema], default: [] },
  },
  { timestamps: true },
);

export type SubscriptionDoc = InferSchemaType<typeof subscriptionSchema>;
export const SubscriptionModel = model('Subscription', subscriptionSchema);
export const AuditLogModel = model('AuditLog', auditLogSchema);
export const TicketModel = model('SupportTicket', ticketSchema);
