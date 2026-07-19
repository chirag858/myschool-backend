import { ApiError } from '../../lib/api-error';
import { signTokens } from '../../lib/jwt';
import { SchoolModel } from '../school/school.model';
import { UserModel } from '../user/user.model';
import { AuditLogModel, SubscriptionModel, TicketModel } from './superadmin.models';

type Doc = Record<string, unknown> & { _id: unknown };
const nowIso = (): string => new Date().toISOString();

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

  async ticketStats() {
    const rows = await TicketModel.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
    const stats = { open: 0, in_progress: 0, testing: 0, resolved: 0 } as Record<string, number>;
    for (const r of rows) if (r._id in stats) stats[r._id as string] = r.n as number;
    return stats;
  },
};
