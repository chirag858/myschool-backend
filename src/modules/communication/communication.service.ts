import { ApiError } from '../../lib/api-error';
import {
  AnnouncementModel,
  CircularModel,
  NotificationModel,
  NotificationPrefsModel,
} from './communication.models';

type Doc = Record<string, unknown> & { _id: unknown };
const isId = (v: unknown): boolean => /^[0-9a-fA-F]{24}$/.test(String(v ?? ''));
const nowIso = (): string => new Date().toISOString();

function dto(d: Doc): Record<string, unknown> {
  const { _id, __v, schoolId, createdAt, updatedAt, ...rest } = d as Record<string, unknown>;
  void __v;
  void schoolId;
  void createdAt;
  void updatedAt;
  return { id: String(_id), ...rest };
}
function toNotification(d: Doc) {
  return {
    id: String(d._id),
    category: d.category ?? 'general',
    title: d.title,
    description: d.description ?? '',
    createdAt: d.createdAt ?? '',
    read: d.read ?? false,
    navigateTo: d.navigateTo,
  };
}

const DEFAULT_PREFS = {
  feePaymentReceived: true,
  newAbsentStudent: true,
  leaveApplicationSubmitted: true,
  newSupportTicket: true,
  subscriptionExpiring: true,
  lowAttendanceWarning: true,
  examResultPublished: true,
};

export const communicationService = {
  async kpi(schoolId: string) {
    const month = nowIso().slice(0, 7);
    const circulars = await CircularModel.find({ schoolId }).lean();
    return {
      messagesToday: 0, // messaging (SMS/WhatsApp) deferred
      circularsThisMonth: circulars.filter((c) => (c.dateOfIssue ?? '').startsWith(month)).length,
      pendingDelivery: circulars.filter((c) => c.status === 'draft').length,
    };
  },

  // ── Circulars ──
  async getCirculars(schoolId: string, q: Record<string, string>) {
    const filter: Record<string, unknown> = { schoolId };
    if (q.status && q.status !== 'all') filter.status = q.status;
    if (q.audience && q.audience !== 'all') filter.audience = q.audience;
    if (q.search?.trim()) filter.title = new RegExp(q.search.trim(), 'i');
    const docs = await CircularModel.find(filter).sort({ createdAt: -1 }).lean();
    return docs.map(dto);
  },
  async upsertCircular(schoolId: string, c: Record<string, unknown>) {
    const { id, ...fields } = c;
    if (isId(id)) {
      const existing = await CircularModel.findOne({ _id: id, schoolId });
      if (existing) {
        existing.set(fields);
        await existing.save();
        return dto(existing.toObject());
      }
    }
    const count = await CircularModel.countDocuments({ schoolId });
    const number = (fields.number as string) || `CIR/${nowIso().slice(0, 4)}/${String(count + 1).padStart(3, '0')}`;
    const doc = await CircularModel.create({ schoolId, ...fields, number, views: 0 });
    return dto(doc.toObject());
  },
  async setCircularStatus(schoolId: string, id: string, status: 'published' | 'archived') {
    const doc = await CircularModel.findOneAndUpdate({ _id: id, schoolId }, { status }, { new: true });
    if (!doc) throw ApiError.notFound('Circular not found');
    return dto(doc.toObject());
  },
  async deleteCircular(schoolId: string, id: string) {
    await CircularModel.deleteOne({ _id: id, schoolId });
    return { success: true };
  },

  // ── Announcements ──
  async getAnnouncements(schoolId: string) {
    const docs = await AnnouncementModel.find({ schoolId }).sort({ pinned: -1, createdAt: -1 }).lean();
    return docs.map(dto);
  },
  async upsertAnnouncement(schoolId: string, a: Record<string, unknown>) {
    const { id, ...fields } = a;
    if (isId(id)) {
      const existing = await AnnouncementModel.findOne({ _id: id, schoolId });
      if (existing) {
        existing.set(fields);
        await existing.save();
        return dto(existing.toObject());
      }
    }
    const doc = await AnnouncementModel.create({ schoolId, ...fields, postedAt: fields.postedAt ?? nowIso() });
    return dto(doc.toObject());
  },
  async deleteAnnouncement(schoolId: string, id: string) {
    await AnnouncementModel.deleteOne({ _id: id, schoolId });
    return { success: true };
  },

  // ── Notifications ──
  async getNotifications(schoolId: string, q: Record<string, string>) {
    const filter: Record<string, unknown> = { schoolId };
    if (q.category && q.category !== 'all') filter.category = q.category;
    if (q.unread === 'true') filter.read = false;
    const docs = await NotificationModel.find(filter).sort({ createdAt: -1 }).lean();
    return docs.map(toNotification);
  },
  async markRead(schoolId: string, id: string) {
    await NotificationModel.updateOne({ _id: id, schoolId }, { read: true });
    return { success: true };
  },
  async markAllRead(schoolId: string) {
    await NotificationModel.updateMany({ schoolId, read: false }, { read: true });
    return { success: true };
  },
  async clearRead(schoolId: string) {
    await NotificationModel.deleteMany({ schoolId, read: true });
    return { success: true };
  },
  async getPreferences(schoolId: string) {
    const doc = await NotificationPrefsModel.findOne({ schoolId }).lean();
    if (!doc) return DEFAULT_PREFS;
    const { _id, __v, schoolId: s, createdAt, updatedAt, ...rest } = doc as Record<string, unknown>;
    void _id;
    void __v;
    void s;
    void createdAt;
    void updatedAt;
    return { ...DEFAULT_PREFS, ...rest };
  },
  async savePreferences(schoolId: string, prefs: Record<string, unknown>) {
    await NotificationPrefsModel.updateOne({ schoolId }, { $set: { schoolId, ...prefs } }, { upsert: true });
    return this.getPreferences(schoolId);
  },
};
