import { Schema, model, type InferSchemaType } from 'mongoose';

export const MESSAGE_CHANNELS = ['sms', 'whatsapp', 'both'] as const;
export const MESSAGE_TEMPLATE_CATEGORIES = ['fee_reminder', 'attendance_alert', 'exam_notice', 'general', 'custom'] as const;

const deliveryReportRowSchema = new Schema(
  {
    recipientId: String,
    recipientName: String,
    recipientMobile: String,
    status: { type: String, enum: ['delivered', 'failed', 'pending'], default: 'pending' },
    failureReason: String,
  },
  { _id: false },
);

const messageHistorySchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    channel: { type: String, enum: MESSAGE_CHANNELS, required: true },
    recipientCount: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    body: { type: String, required: true },
    status: { type: String, enum: ['draft', 'scheduled', 'sent', 'partial', 'failed'], default: 'sent' },
    scheduledAt: String,
    deliveryReport: { type: [deliveryReportRowSchema], default: [] },
  },
  { timestamps: true },
);
export type MessageHistoryDoc = InferSchemaType<typeof messageHistorySchema>;
export const MessageHistoryModel = model('MessageHistory', messageHistorySchema);

const messageTemplateSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    name: { type: String, required: true },
    type: { type: String, enum: MESSAGE_CHANNELS, required: true },
    category: { type: String, enum: MESSAGE_TEMPLATE_CATEGORIES, default: 'general' },
    body: { type: String, required: true },
  },
  { timestamps: true },
);
export type MessageTemplateDoc = InferSchemaType<typeof messageTemplateSchema>;
export const MessageTemplateModel = model('MessageTemplate', messageTemplateSchema);
