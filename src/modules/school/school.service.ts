import { randomUUID } from 'node:crypto';

import bcrypt from 'bcryptjs';
import type { FilterQuery } from 'mongoose';

import { ApiError } from '../../lib/api-error';
import { ClassModel } from '../academics/academics.models';
import { FeeStructureModel } from '../fee/fee.models';
import { StudentModel } from '../students/student.model';
import { UserModel } from '../user/user.model';
import { MODULE_KEYS, SchoolModel, type SchoolDoc } from './school.model';

const STAFF_ROLES = [
  'school_admin', 'principal', 'coordinator', 'accountant', 'teacher', 'receptionist', 'gate_manager',
];

interface SchoolsQuery {
  page?: number;
  pageSize?: number;
  status?: string;
  plan?: string;
  search?: string;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fullModules(stored: Record<string, unknown> | null | undefined): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const key of MODULE_KEYS) out[key] = stored?.[key] !== false; // default true
  return out;
}

async function studentCount(schoolId: unknown): Promise<number> {
  return StudentModel.countDocuments({ schoolId });
}
async function staffCount(schoolId: unknown): Promise<number> {
  return UserModel.countDocuments({ schoolId, role: { $in: STAFF_ROLES } });
}

/** Uppercase letters from the school name, e.g. "Vibgyor School" -> "VIBGYOR". */
function codeBase(name: string): string {
  const words = name.trim().toUpperCase().split(/\s+/).filter(Boolean);
  let base = (words[0] ?? '').replace(/[^A-Z0-9]/g, '');
  let i = 1;
  while (base.length < 3 && i < words.length) {
    base += words[i]!.replace(/[^A-Z0-9]/g, '');
    i += 1;
  }
  base = base.slice(0, 10);
  return base.length >= 3 ? base : `${base}SCH`.slice(0, 10);
}

export const schoolService = {
  /** Picks the plain name-derived code if free, else appends the lowest free suffix. */
  async generateSchoolCode(name: string) {
    const base = codeBase(name);
    const existing = await SchoolModel.find({ code: new RegExp(`^${base}\\d*$`) })
      .select('code')
      .lean();
    const taken = new Set(existing.map((d) => d.code));
    if (!taken.has(base)) return { code: base };
    let n = 2;
    while (taken.has(`${base}${n}`)) n += 1;
    return { code: `${base}${n}` };
  },

  async checkSchoolCode(code: string) {
    const taken = (await SchoolModel.exists({ code: code.toUpperCase() })) !== null;
    return { taken };
  },


  async getSchools(query: SchoolsQuery) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.max(1, Number(query.pageSize) || 8);

    const filter: FilterQuery<SchoolDoc> = {};
    if (query.status && query.status !== 'all') filter.status = query.status;
    if (query.plan && query.plan !== 'all') filter.plan = query.plan;
    if (query.search?.trim()) {
      const rx = new RegExp(escapeRegex(query.search.trim()), 'i');
      filter.$or = [{ name: rx }, { code: rx }, { city: rx }];
    }

    const [docs, total] = await Promise.all([
      SchoolModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      SchoolModel.countDocuments(filter),
    ]);

    const counts = await StudentModel.aggregate<{ _id: unknown; count: number }>([
      { $match: { schoolId: { $in: docs.map((d) => d._id) } } },
      { $group: { _id: '$schoolId', count: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((c) => [String(c._id), c.count]));

    const rows = docs.map((d) => ({
      id: String(d._id),
      code: d.code,
      name: d.name,
      city: d.city ?? '',
      state: d.state ?? '',
      plan: d.plan,
      status: d.status,
      expiryDate: d.expiryDate ?? '',
      studentCount: countMap.get(String(d._id)) ?? 0,
      lastLoginAt: d.lastLoginAt ? new Date(d.lastLoginAt).toISOString() : null,
      logoUrl: d.logoUrl,
    }));

    return { rows, total, page, pageSize };
  },

  async getSchoolList() {
    const docs = await SchoolModel.find().select('name').sort({ name: 1 }).lean();
    return docs.map((d) => ({ id: String(d._id), name: d.name }));
  },

  async getSchoolDetail(id: string) {
    const d = await SchoolModel.findById(id).lean();
    if (!d) throw ApiError.notFound('School not found');
    const [students, staff] = await Promise.all([studentCount(d._id), staffCount(d._id)]);

    const currentSubscription = d.subscription ?? {
      id: `sub_${String(d._id).slice(-8)}`,
      plan: d.plan,
      startDate: '',
      endDate: d.expiryDate ?? '',
      graceDays: 0,
      paymentMethod: 'cash',
      paymentReference: '',
      amountPaid: 0,
      status: 'active',
      addedBy: 'System',
      createdAt: new Date((d as { createdAt?: Date }).createdAt ?? Date.now()).toISOString(),
    };

    return {
      id: String(d._id),
      code: d.code,
      name: d.name,
      type: d.type,
      board: d.board,
      addressLine1: d.addressLine1 ?? '',
      addressLine2: d.addressLine2,
      city: d.city ?? '',
      state: d.state ?? '',
      pinCode: d.pinCode ?? '',
      contactMobile: d.contactMobile ?? '',
      contactEmail: d.contactEmail ?? '',
      principalName: d.principalName ?? '',
      establishedYear: d.establishedYear ?? 2000,
      status: d.status,
      plan: d.plan,
      expiryDate: d.expiryDate ?? '',
      studentCount: students,
      staffCount: staff,
      monthlyFeesCollected: 0,
      branding: d.branding ?? {},
      currentSubscription,
      createdAt: new Date((d as { createdAt?: Date }).createdAt ?? Date.now()).toISOString(),
    };
  },

  async createSchool(p: {
    identity: Record<string, unknown> & { code: string; name: string };
    branding: Record<string, unknown>;
    subscription: Record<string, unknown> & { plan: string; endDate: string };
  }) {
    const existing = await SchoolModel.findOne({ code: String(p.identity.code).toUpperCase() });
    if (existing) throw ApiError.conflict('A school with this code already exists');

    const now = new Date().toISOString();
    const doc = await SchoolModel.create({
      name: p.identity.name,
      code: p.identity.code,
      type: p.identity.type,
      board: p.identity.board,
      addressLine1: p.identity.addressLine1,
      addressLine2: p.identity.addressLine2,
      city: p.identity.city,
      state: p.identity.state,
      pinCode: p.identity.pinCode,
      contactMobile: p.identity.contactMobile,
      contactEmail: p.identity.contactEmail,
      principalName: p.identity.principalName,
      establishedYear: p.identity.establishedYear,
      status: 'active',
      plan: p.subscription.plan,
      expiryDate: p.subscription.endDate,
      branding: {
        headerText: p.branding.headerText,
        footerText: p.branding.footerText,
        primaryColor: p.branding.primaryColor,
      },
      subscription: {
        id: `sub_${randomUUID().slice(0, 8)}`,
        plan: p.subscription.plan,
        startDate: p.subscription.startDate,
        endDate: p.subscription.endDate,
        graceDays: p.subscription.graceDays,
        paymentMethod: p.subscription.paymentMethod,
        paymentReference: p.subscription.paymentReference,
        amountPaid: p.subscription.amountPaid,
        notes: p.subscription.notes,
        status: 'active',
        addedBy: 'Super Admin',
        createdAt: now,
      },
    });

    // Every school needs at least one school_admin to log into its panel —
    // without this, super-admin's "Login as school admin" impersonation
    // 404s ("no admin to impersonate") for every newly onboarded school.
    const tempPassword = randomUUID().slice(0, 10);
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    await UserModel.create({
      name: String(p.identity.principalName ?? `${doc.name} Admin`),
      username: String(p.identity.contactEmail).toLowerCase(),
      email: String(p.identity.contactEmail).toLowerCase(),
      mobile: p.identity.contactMobile,
      role: 'school_admin',
      passwordHash,
      schoolId: doc._id,
      schoolName: doc.name,
      active: true,
    });

    return {
      id: String(doc._id),
      code: doc.code,
      adminEmail: String(p.identity.contactEmail).toLowerCase(),
      adminTempPassword: tempPassword,
    };
  },

  async setSchoolStatus(id: string, status: string, reason?: string) {
    const active = status === 'active' || status === 'trial';
    const update: Record<string, unknown> = { status, active };
    if (reason !== undefined) update.suspensionReason = reason;
    const doc = await SchoolModel.findByIdAndUpdate(id, update, { new: true });
    if (!doc) throw ApiError.notFound('School not found');
    return { success: true };
  },

  async getActivationOverview() {
    const [pendingDocs, blockedDocs] = await Promise.all([
      SchoolModel.find({ status: 'pending_setup' }).sort({ createdAt: -1 }).lean(),
      SchoolModel.find({ status: { $in: ['suspended', 'expired'] } })
        .sort({ updatedAt: -1 })
        .lean(),
    ]);

    const pending = await Promise.all(
      pendingDocs.map(async (d) => {
        const [feeStructure, classesAdded, adminUser] = await Promise.all([
          FeeStructureModel.exists({ schoolId: d._id }),
          ClassModel.exists({ schoolId: d._id }),
          UserModel.exists({ schoolId: d._id, role: { $in: ['school_admin', 'principal'] } }),
        ]);
        return {
          id: String(d._id),
          name: d.name,
          createdAt: new Date((d as { createdAt?: Date }).createdAt ?? Date.now()).toISOString(),
          createdBy: 'Super Admin',
          status: d.status,
          setup: {
            feeStructure: Boolean(feeStructure),
            classesAdded: Boolean(classesAdded),
            adminUser: Boolean(adminUser),
            logoUploaded: Boolean(d.branding?.logoUrl ?? d.logoUrl),
          },
        };
      }),
    );

    const suspendedOrExpired = blockedDocs.map((d) => ({
      id: String(d._id),
      name: d.name,
      createdAt: new Date((d as { createdAt?: Date }).createdAt ?? Date.now()).toISOString(),
      createdBy: 'Super Admin',
      status: d.status,
      setup: { feeStructure: true, classesAdded: true, adminUser: true, logoUploaded: true },
      lastActiveAt: d.lastLoginAt ? new Date(d.lastLoginAt).toISOString() : undefined,
      reason: d.suspensionReason || undefined,
    }));

    return { pending, suspendedOrExpired };
  },

  async deleteSchool(id: string) {
    const doc = await SchoolModel.findByIdAndDelete(id);
    if (!doc) throw ApiError.notFound('School not found');
    await UserModel.deleteMany({ schoolId: id });
  },

  async getSchoolModules(id: string): Promise<Record<string, boolean>> {
    const doc = await SchoolModel.findById(id).lean();
    if (!doc) throw ApiError.notFound('School not found');
    return fullModules(doc.moduleFlags as Record<string, unknown> | undefined);
  },

  async setSchoolModules(id: string, incoming: Record<string, boolean>): Promise<Record<string, boolean>> {
    const doc = await SchoolModel.findById(id);
    if (!doc) throw ApiError.notFound('School not found');
    const merged = fullModules(doc.moduleFlags as Record<string, unknown> | undefined);
    for (const key of MODULE_KEYS) {
      if (key in incoming) merged[key] = Boolean(incoming[key]);
    }
    doc.moduleFlags = merged;
    doc.markModified('moduleFlags');
    await doc.save();
    return merged;
  },

  async getDashboardStats() {
    const all = await SchoolModel.find().lean();
    const planBreakdown: Record<string, number> = {
      monthly: 0,
      quarterly: 0,
      half_yearly: 0,
      yearly: 0,
    };
    let activeSchools = 0;
    let expiredSchools = 0;
    let pendingRenewals = 0;
    let monthlyRevenue = 0;
    const soon = Date.now() + 30 * 24 * 60 * 60 * 1000;

    for (const s of all) {
      planBreakdown[s.plan] = (planBreakdown[s.plan] ?? 0) + 1;
      if (s.status === 'active') activeSchools += 1;
      if (s.status === 'expired') expiredSchools += 1;
      if (s.status === 'active' && s.expiryDate && new Date(s.expiryDate).getTime() < soon) {
        pendingRenewals += 1;
      }
      monthlyRevenue += s.subscription?.amountPaid ?? 0;
    }

    return {
      totalSchools: all.length,
      activeSchools,
      expiredSchools,
      pendingRenewals,
      activeSubscriptions: activeSchools,
      planBreakdown,
      monthlyRevenue,
      revenueChangePct: 0,
    };
  },
};
