import { ApiError } from '../../lib/api-error';
import { sendBulk, type MessagingChannel } from '../../lib/messaging-provider';
import { StudentModel } from '../students/student.model';
import { MessageHistoryModel, MessageTemplateModel } from './messaging.models';

type Doc = Record<string, unknown> & { _id: unknown };

function toHistoryRow(d: Doc) {
  return {
    id: String(d._id),
    sentAt: (d as { createdAt?: Date }).createdAt?.toISOString() ?? new Date().toISOString(),
    channel: d.channel,
    recipientCount: d.recipientCount ?? 0,
    delivered: d.delivered ?? 0,
    failed: d.failed ?? 0,
    body: d.body,
    status: d.status,
    scheduledAt: d.scheduledAt,
  };
}
function toTemplate(d: Doc) {
  return { id: String(d._id), name: d.name, type: d.type, category: d.category, body: d.body };
}

export const messagingService = {
  async getMessages(schoolId: string) {
    const docs = await MessageHistoryModel.find({ schoolId }).sort({ createdAt: -1 }).limit(200).lean();
    return docs.map(toHistoryRow);
  },

  async sendMessage(
    schoolId: string,
    payload: { channel: MessagingChannel; recipientCount: number; body: string; scheduleAt?: string },
  ) {
    if (payload.scheduleAt && new Date(payload.scheduleAt).getTime() > Date.now()) {
      const doc = await MessageHistoryModel.create({
        schoolId,
        channel: payload.channel,
        recipientCount: payload.recipientCount,
        delivered: 0,
        failed: 0,
        body: payload.body,
        status: 'scheduled',
        scheduledAt: payload.scheduleAt,
        deliveryReport: [],
      });
      return toHistoryRow(doc.toObject());
    }

    // No dedicated audience-selection endpoint exists yet — sample real
    // students in the school as delivery targets up to the requested count.
    const students = await StudentModel.find({ schoolId }).limit(payload.recipientCount).lean();
    const recipients = students.map((s) => ({
      id: String(s._id),
      name: s.name,
      mobile: (s.parents as { fatherMobile?: string } | undefined)?.fatherMobile ?? s.mobile ?? '',
    }));
    const results = await sendBulk(recipients, payload.channel, payload.body);
    const delivered = results.filter((r) => r.status === 'delivered').length;
    const failed = results.filter((r) => r.status === 'failed').length;
    const status = failed === 0 ? 'sent' : delivered === 0 ? 'failed' : 'partial';

    const doc = await MessageHistoryModel.create({
      schoolId,
      channel: payload.channel,
      recipientCount: payload.recipientCount,
      delivered,
      failed,
      body: payload.body,
      status,
      deliveryReport: results,
    });
    return toHistoryRow(doc.toObject());
  },

  async getDeliveryReport(schoolId: string, id: string) {
    const doc = await MessageHistoryModel.findOne({ _id: id, schoolId }).lean();
    if (!doc) throw ApiError.notFound('Message not found');
    return (doc.deliveryReport ?? []) as unknown[];
  },

  async resendFailed(schoolId: string, id: string) {
    const doc = await MessageHistoryModel.findOne({ _id: id, schoolId });
    if (!doc) throw ApiError.notFound('Message not found');
    const failedRows = (doc.deliveryReport ?? []).filter((r) => r.status === 'failed');
    if (failedRows.length === 0) return { resent: 0 };

    const recipients = failedRows.map((r) => ({ id: r.recipientId ?? '', name: r.recipientName ?? '', mobile: r.recipientMobile ?? '' }));
    const results = await sendBulk(recipients, doc.channel as MessagingChannel, doc.body);
    const newlyDelivered = results.filter((r) => r.status === 'delivered').length;

    const resultById = new Map(results.map((r) => [r.recipientId, r]));
    const merged = doc.deliveryReport.map((row) => resultById.get(row.recipientId ?? '') ?? row.toObject());
    doc.set('deliveryReport', merged);
    doc.delivered = (doc.delivered ?? 0) + newlyDelivered;
    doc.failed = Math.max(0, (doc.failed ?? 0) - newlyDelivered);
    doc.status = doc.failed === 0 ? 'sent' : 'partial';
    await doc.save();
    return { resent: newlyDelivered };
  },

  async getTemplates(schoolId: string) {
    const docs = await MessageTemplateModel.find({ schoolId }).sort({ createdAt: -1 }).lean();
    return docs.map(toTemplate);
  },
  async upsertTemplate(schoolId: string, payload: Record<string, unknown>) {
    const { id, ...rest } = payload as { id?: string; [k: string]: unknown };
    if (id) {
      const doc = await MessageTemplateModel.findOneAndUpdate({ _id: id, schoolId }, { $set: rest }, { new: true });
      if (!doc) throw ApiError.notFound('Template not found');
      return toTemplate(doc.toObject());
    }
    const doc = await MessageTemplateModel.create({ schoolId, ...rest });
    return toTemplate(doc.toObject());
  },
  async deleteTemplate(schoolId: string, id: string) {
    await MessageTemplateModel.deleteOne({ _id: id, schoolId });
    return { success: true };
  },
};
