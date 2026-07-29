import { ApiError } from '../../lib/api-error';
import { SchoolModel } from '../school/school.model';
import { TicketModel } from '../superadmin/superadmin.models';
import {
  AnnouncementModel,
  CircularModel,
  NotificationModel,
  NotificationPrefsModel,
  PlatformNotificationReadModel,
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

  // ── Platform notifications (super_admin/support_engineer) ──
  // No cross-module event bus exists yet, so these are derived from real
  // data (recent onboarding, expiring subscriptions, open tickets) rather
  // than stored documents; read-state is tracked per user separately.
  async getPlatformNotifications(userId: string) {
    const [items, readDoc] = await Promise.all([
      derivePlatformNotifications(),
      PlatformNotificationReadModel.findOne({ userId }).lean(),
    ]);
    const readIds = new Set(readDoc?.readIds ?? []);
    return items.map((item) => ({ ...item, read: readIds.has(item.id) }));
  },
  async markAllPlatformRead(userId: string) {
    const items = await derivePlatformNotifications();
    await PlatformNotificationReadModel.updateOne(
      { userId },
      { $addToSet: { readIds: { $each: items.map((item) => item.id) } } },
      { upsert: true },
    );
    return { success: true };
  },
};

const ONBOARDED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const EXPIRING_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

async function derivePlatformNotifications(): Promise<
  Array<{ id: string; category: string; title: string; description: string; createdAt: string }>
> {
  const now = Date.now();
  const items: Array<{ id: string; category: string; title: string; description: string; createdAt: string }> = [];

  const recentSchools = await SchoolModel.find({
    createdAt: { $gte: new Date(now - ONBOARDED_WINDOW_MS) },
  })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();
  for (const school of recentSchools) {
    items.push({
      id: `school:${String(school._id)}:onboarded`,
      category: 'success',
      title: 'New school onboarded',
      description: `${school.name} completed signup.`,
      createdAt: new Date((school as { createdAt?: Date }).createdAt ?? now).toISOString(),
    });
  }

  const candidates = await SchoolModel.find({ expiryDate: { $ne: '' } })
    .select('name expiryDate')
    .lean();
  const expiringSoon = candidates.filter((school) => {
    const expiry = new Date(school.expiryDate as string).getTime();
    return Number.isFinite(expiry) && expiry >= now && expiry - now <= EXPIRING_WINDOW_MS;
  });
  if (expiringSoon.length > 0) {
    const names = expiringSoon.slice(0, 3).map((school) => school.name).join(', ');
    items.push({
      id: 'schools:expiring-soon',
      category: 'warning',
      title: 'Subscriptions expiring soon',
      description:
        expiringSoon.length > 3
          ? `${names} and ${expiringSoon.length - 3} more expire within 14 days.`
          : `${names} expire${expiringSoon.length === 1 ? 's' : ''} within 14 days.`,
      createdAt: new Date(now).toISOString(),
    });
  }

  const openTickets = await TicketModel.find({ status: { $in: ['open', 'in_progress'] } })
    .sort({ createdAt: -1 })
    .select('createdAt')
    .lean();
  if (openTickets.length > 0) {
    const latest = openTickets[0] as { createdAt?: Date };
    items.push({
      id: 'tickets:open',
      category: 'info',
      title: 'Open support tickets',
      description: `${openTickets.length} ticket${openTickets.length === 1 ? '' : 's'} awaiting response.`,
      createdAt: new Date(latest.createdAt ?? now).toISOString(),
    });
  }

  return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
