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

/** Support ticket (for the platform ticket-stats widget). */
const ticketSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', index: true },
    subject: { type: String, default: '' },
    status: { type: String, enum: ['open', 'in_progress', 'testing', 'resolved'], default: 'open' },
  },
  { timestamps: true },
);

export type SubscriptionDoc = InferSchemaType<typeof subscriptionSchema>;
export const SubscriptionModel = model('Subscription', subscriptionSchema);
export const AuditLogModel = model('AuditLog', auditLogSchema);
export const TicketModel = model('SupportTicket', ticketSchema);
