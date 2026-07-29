import { ApiError } from '../../lib/api-error';
import { signTokens } from '../../lib/jwt';
import { SchoolModel } from '../school/school.model';
import { UserModel } from '../user/user.model';
import { AuditLogModel, SubscriptionModel, TicketModel } from './superadmin.models';

type Doc = Record<string, unknown> & { _id: unknown };
const nowIso = (): string => new Date().toISOString();

// School.subscription.paymentMethod uses PAYMENT_METHODS ('bank_transfer'),
// but the frontend billing page's vocabulary is 'bank' — translate here
// rather than making the frontend aware of the backend's enum spelling.
function toPaymentMode(method: unknown): string {
  return method === 'bank_transfer' ? 'bank' : String(method ?? 'cash');
}

function subscriptionView(d: Doc): Record<string, unknown> {
  return {
    id: String(d._id),
    plan: d.plan,
    startDate: d.startDate ?? '',
    endDate: d.endDate ?? '',
    graceDays: d.graceDays ?? 0,
    paymentMethod: d.paymentMethod ?? 'cash',
    paymentReference: d.paymentReference ?? '',
    amountPaid: d.amountPaid ?? 0,
    notes: d.notes,
    status: d.status ?? 'active',
    addedBy: d.addedBy ?? 'Super Admin',
    createdAt: d.createdAt ?? '',
  };
}

function auditView(d: Doc): Record<string, unknown> {
  return {
    id: String(d._id),
    timestamp: d.timestamp ?? '',
    actorName: d.actorName ?? '',
    actorRole: d.actorRole ?? '',
    action: d.action ?? '',
    module: d.module ?? '',
    status: d.status ?? 'success',
    ipAddress: d.ipAddress,
  };
}

// AuditLog.action is stored as free-text ("Collected fee", "Logged in") —
// the full audit-logs page instead wants one of a fixed set of categories
// for its filter dropdown/badge translations. Bucket by keyword; anything
// unrecognized falls back to 'updated' rather than showing an untranslated
// raw string.
function normalizeAuditAction(text: unknown): string {
  const s = String(text ?? '').toLowerCase();
  if (s.includes('login') || s.includes('logged in') || s.includes('log in')) return 'login';
  if (s.includes('logout') || s.includes('logged out') || s.includes('log out')) return 'logout';
  if (s.includes('fee') || s.includes('payment') || s.includes('collected')) return 'payment';
  if (s.includes('readjust')) return 'readjustment';
  if (s.includes('delete')) return 'deleted';
  if (s.includes('export')) return 'exported';
  if (s.includes('approve')) return 'approved';
  if (s.includes('reject')) return 'rejected';
  if (s.includes('override')) return 'override';
  if (s.includes('created') || s.includes('added')) return 'created';
  return 'updated';
}

function fullAuditView(d: Doc, schoolName: string): Record<string, unknown> {
  return {
    id: String(d._id),
    timestamp: d.timestamp ?? '',
    userName: d.actorName ?? '',
    role: d.actorRole ?? '',
    schoolName,
    module: d.module ?? '',
    action: normalizeAuditAction(d.action),
    recordAffected: '',
    description: d.action ?? '',
    oldValue: null,
    newValue: null,
    ipAddress: d.ipAddress ?? '',
  };
}

async function requireSchool(schoolId: string): Promise<Doc> {
  const school = await SchoolModel.findById(schoolId).lean();
  if (!school) throw ApiError.notFound('School not found');
  return school as Doc;
}

export const superAdminService = {
  // Static platform infra snapshot (no host metrics collector wired). ponytail: static, wire a real collector if ops needs it.
  infrastructure() {
    return {
      cpuPercent: 42,
      ram: { usedGb: 9.4, totalGb: 16 },
      ssd: { usedGb: 187, totalGb: 512 },
    };
  },

  async revenueChart() {
    const subs = await SubscriptionModel.find({}).lean();
    const buckets = new Map<string, number>();
    for (const s of subs) {
      const label = String(s.createdAt ?? '').slice(0, 7) || 'unknown';
      buckets.set(label, (buckets.get(label) ?? 0) + Number(s.amountPaid ?? 0));
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([label, value]) => ({ label, value }));
  },

  async getSubscriptions(schoolId: string) {
    await requireSchool(schoolId);
    return (await SubscriptionModel.find({ schoolId }).sort({ createdAt: -1 }).lean()).map(subscriptionView);
  },

  async renewSubscription(schoolId: string, payload: Record<string, unknown>) {
    await requireSchool(schoolId);
    const createdAt = nowIso();
    const doc = await SubscriptionModel.create({
      schoolId,
      plan: payload.plan,
      startDate: payload.startDate,
      endDate: payload.endDate,
      graceDays: Number(payload.graceDays ?? 0),
      paymentMethod: payload.paymentMethod,
      paymentReference: payload.paymentReference,
      amountPaid: Number(payload.amountPaid ?? 0),
      notes: payload.notes,
      status: 'active',
      addedBy: 'Super Admin',
      createdAt,
    });
    // Reflect the new subscription onto the school's current state.
    await SchoolModel.updateOne(
      { _id: schoolId },
      {
        $set: {
          plan: payload.plan,
          status: 'active',
          expiryDate: payload.endDate,
          subscription: { ...subscriptionView(doc.toObject() as Doc) },
        },
      },
    );
    return subscriptionView(doc.toObject() as Doc);
  },

  async getBillingOverview() {
    const [schools, subs] = await Promise.all([
      SchoolModel.find({}).lean(),
      SubscriptionModel.find({}).sort({ createdAt: -1 }).lean(),
    ]);
    const schoolNameById = new Map(schools.map((s) => [String(s._id), s.name]));
    const now = Date.now();

    const subscriptions = schools.map((s) => {
      const sub = (s.subscription as Record<string, unknown> | undefined) ?? {};
      const endDate = String(sub.endDate ?? s.expiryDate ?? '');
      const startDate = String(sub.startDate ?? '');
      const daysRemaining = endDate
        ? Math.round((new Date(endDate).getTime() - now) / (24 * 60 * 60 * 1000))
        : 0;
      const graceDays = Number(sub.graceDays ?? 0);
      const status =
        s.status === 'trial'
          ? 'trial'
          : daysRemaining > 0
            ? 'active'
            : daysRemaining >= -graceDays
              ? 'grace'
              : 'expired';
      return {
        id: String(s._id),
        schoolId: String(s._id),
        schoolName: s.name,
        planType: s.plan,
        startDate,
        endDate,
        daysRemaining,
        amount: Number(sub.amountPaid ?? 0),
        paymentStatus: Number(sub.amountPaid ?? 0) > 0 ? 'paid' : 'pending',
        lastPaymentDate: sub.createdAt ? new Date(String(sub.createdAt)).toISOString() : undefined,
        status,
      };
    });

    const payments = subs.map((d) => ({
      id: String(d._id),
      schoolId: String(d.schoolId),
      schoolName: schoolNameById.get(String(d.schoolId)) ?? 'Unknown school',
      planType: d.plan,
      amount: Number(d.amountPaid ?? 0),
      date: d.createdAt ? new Date(String(d.createdAt)).toISOString() : now.toString(),
      paymentMode: toPaymentMode(d.paymentMethod),
      reference: d.paymentReference ?? '',
      processedBy: d.addedBy ?? 'Super Admin',
      status: d.status === 'pending' ? 'pending' : 'paid',
      invoiceNumber: `INV-${String(d._id).slice(-6).toUpperCase()}`,
    }));

    return { subscriptions, payments };
  },

  async renewBilling(payload: {
    schoolId: string;
    plan: string;
    amount: number;
    paymentMethod: string;
    paymentReference: string;
  }) {
    const durationDays: Record<string, number> = {
      monthly: 30,
      quarterly: 91,
      half_yearly: 182,
      yearly: 365,
    };
    const startDate = nowIso().slice(0, 10);
    const endDate = new Date(Date.now() + (durationDays[payload.plan] ?? 365) * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    return this.renewSubscription(payload.schoolId, {
      plan: payload.plan,
      startDate,
      endDate,
      graceDays: 7,
      paymentMethod: payload.paymentMethod,
      paymentReference: payload.paymentReference,
      amountPaid: payload.amount,
    });
  },

  async addGracePeriod(schoolId: string, days: number) {
    const school = await requireSchool(schoolId);
    const sub = (school.subscription as Record<string, unknown> | undefined) ?? {};
    const currentEnd = String(sub.endDate ?? school.expiryDate ?? nowIso().slice(0, 10));
    const newGraceDays = Number(sub.graceDays ?? 0) + days;
    await SchoolModel.updateOne(
      { _id: schoolId },
      {
        $set: {
          'subscription.graceDays': newGraceDays,
        },
      },
    );
    return { schoolId, graceDays: newGraceDays, currentEnd };
  },

  async getSchoolUsers(schoolId: string) {
    await requireSchool(schoolId);
    const users = await UserModel.find({ schoolId, role: { $in: ['school_admin', 'principal'] } }).lean();
    return users.map((u) => ({
      id: String(u._id),
      name: u.name,
      email: (u.email as string) ?? '',
      mobile: (u.mobile as string) ?? '',
      role: u.role,
      status: u.active === false ? 'disabled' : 'active',
      lastLoginAt: ((u as Record<string, unknown>).lastLoginAt as string) ?? null,
    }));
  },

  async getSchoolAuditLogs(schoolId: string) {
    await requireSchool(schoolId);
    return (await AuditLogModel.find({ schoolId }).sort({ timestamp: -1 }).lean()).map(auditView);
  },

  async getSchoolRecentActivity(schoolId: string) {
    await requireSchool(schoolId);
    const rows = await AuditLogModel.find({ schoolId }).sort({ timestamp: -1 }).limit(20).lean();
    return rows.map((r) => ({
      id: String(r._id),
      timestamp: (r.timestamp as string) ?? '',
      actor: (r.actorName as string) ?? '',
      action: (r.action as string) ?? '',
      module: (r.module as string) ?? '',
    }));
  },

  async impersonate(schoolId: string) {
    const school = await requireSchool(schoolId);
    const admin =
      (await UserModel.findOne({ schoolId, role: 'school_admin', active: { $ne: false } }).lean()) ??
      (await UserModel.findOne({ schoolId, role: 'school_admin' }).lean()) ??
      (await UserModel.findOne({ schoolId, role: 'principal' }).lean());
    if (!admin) throw ApiError.notFound('No school admin to impersonate');
    const tokens = signTokens({ sub: String(admin._id), role: String(admin.role), schoolId });
    return {
      token: tokens.accessToken,
      schoolId,
      schoolName: (school.name as string) ?? 'School',
      expiresAt: tokens.expiresAt,
      adminUser: {
        id: String(admin._id),
        name: admin.name,
        email: (admin.email as string) ?? '',
        mobile: (admin.mobile as string) ?? '',
        role: admin.role,
        status: admin.active === false ? 'disabled' : 'active',
        lastLoginAt: ((admin as Record<string, unknown>).lastLoginAt as string) ?? null,
      },
    };
  },

  async getAuditLogs(limit: number) {
    return (await AuditLogModel.find({}).sort({ timestamp: -1 }).limit(limit).lean()).map(auditView);
  },

  async getFullAuditLogs(filter: { module?: string; action?: string; search?: string }) {
    const query: Record<string, unknown> = {};
    if (filter.module && filter.module !== 'all') query.module = filter.module;
    if (filter.search?.trim()) {
      const rx = new RegExp(filter.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ actorName: rx }, { action: rx }];
    }

    const docs = await AuditLogModel.find(query).sort({ timestamp: -1 }).limit(500).lean();
    const schoolIds = [...new Set(docs.map((d) => String(d.schoolId)))];
    const schools = await SchoolModel.find({ _id: { $in: schoolIds } }).select('name').lean();
    const schoolNameById = new Map(schools.map((s) => [String(s._id), s.name]));

    let rows = docs.map((d) => fullAuditView(d as Doc, schoolNameById.get(String(d.schoolId)) ?? 'Unknown school'));
    if (filter.action && filter.action !== 'all') {
      rows = rows.filter((r) => r.action === filter.action);
    }
    return rows;
  },

  async getAuditLogDetail(id: string) {
    const doc = await AuditLogModel.findById(id).lean();
    if (!doc) return null;
    const school = doc.schoolId ? await SchoolModel.findById(doc.schoolId).select('name').lean() : null;
    return fullAuditView(doc as Doc, school?.name ?? 'Unknown school');
  },

  async ticketStats() {
    const rows = await TicketModel.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
    const stats = { open: 0, in_progress: 0, testing: 0, resolved: 0 } as Record<string, number>;
    for (const r of rows) if (r._id in stats) stats[r._id as string] = r.n as number;
    return stats;
  },
};
