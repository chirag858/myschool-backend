import { ApiError } from '../../lib/api-error';
import { AttendanceModel } from '../attendance/attendance.models';
import { ReceiptModel } from '../fee/fee.models';
import { feeService } from '../fee/fee.service';
import { StaffModel, StaffAttendanceModel } from '../staff/staff.models';
import { StudentModel } from '../students/student.model';
import { ApprovalModel } from './admin-app.models';

type Doc = Record<string, unknown> & { _id: unknown };
const nowIso = (): string => new Date().toISOString();
const today = (): string => nowIso().slice(0, 10);
const pct = (n: number, d: number): number => (d ? Math.round((n / d) * 100) : 0);

function classifyMode(mode: string): 'cash' | 'online' | 'bank' {
  if (mode === 'cash') return 'cash';
  if (['online', 'upi', 'card'].includes(mode)) return 'online';
  return 'bank';
}

async function collections(schoolId: string) {
  const receipts = await ReceiptModel.find({ schoolId, status: 'active' }).lean();
  const c = { cash: 0, online: 0, bank: 0, total: 0 };
  for (const r of receipts) {
    const amt = Number(r.amount ?? 0);
    c[classifyMode((r.paymentMode as string) ?? 'cash')] += amt;
    c.total += amt;
  }
  return c;
}

async function studentAttendance(schoolId: string) {
  const active = await StudentModel.countDocuments({ schoolId, profileStatus: 'active' });
  const marks = await AttendanceModel.find({ schoolId, date: today() }).lean();
  const present = marks.filter((m) => m.status === 'present').length;
  const absent = marks.filter((m) => m.status === 'absent').length;
  return { active, pct: marks.length ? pct(present, marks.length) : 0, absentToday: absent };
}

async function staffAttendancePct(schoolId: string) {
  const total = await StaffModel.countDocuments({ schoolId });
  const marks = await StaffAttendanceModel.find({ schoolId, date: today() }).lean();
  const present = marks.filter((m) => m.status === 'present').length;
  return marks.length ? pct(present, marks.length) : total ? 100 : 0;
}

function approvalView(d: Doc): Record<string, unknown> {
  return {
    id: String(d._id),
    type: d.type,
    title: d.title,
    subtitle: d.subtitle,
    currentLevel: d.currentLevel,
    status: d.status,
    createdAt: d.createdAt,
    amount: d.amount,
    fields: (d.fields as unknown[]) ?? [],
    trail: (d.trail as unknown[]) ?? [],
  };
}

export const adminAppService = {
  async dashboard(schoolId: string) {
    const [coll, sa, staffPct, pendingApprovals] = await Promise.all([
      collections(schoolId),
      studentAttendance(schoolId),
      staffAttendancePct(schoolId),
      ApprovalModel.find({ schoolId, status: 'pending' }).lean(),
    ]);
    const badges: Record<string, number> = {};
    for (const a of pendingApprovals) badges[a.type as string] = (badges[a.type as string] ?? 0) + 1;
    badges.approvals = pendingApprovals.length;
    return {
      collections: coll,
      vitals: {
        enrollmentGrowthPct: 0,
        staffAttendancePct: staffPct,
        studentAttendancePct: sa.pct,
        absentionToday: sa.absentToday,
        enrollmentTotal: sa.active,
      },
      branches: [],
      badges,
    };
  },

  async feeSummary(schoolId: string) {
    const [coll, ledger] = await Promise.all([collections(schoolId), feeService.ledger(schoolId, {})]);
    const byClassMap = new Map<string, { due: number; collected: number }>();
    for (const r of ledger) {
      const cur = byClassMap.get(r.className) ?? { due: 0, collected: 0 };
      cur.due += r.balance;
      cur.collected += r.paid;
      byClassMap.set(r.className, cur);
    }
    return {
      collections: coll,
      totalOutstanding: ledger.reduce((s, r) => s + r.balance, 0),
      byClass: [...byClassMap.entries()].map(([className, v]) => ({ className, due: v.due, collected: v.collected })),
    };
  },

  async attendanceSummary(schoolId: string) {
    const [sa, staffPct] = await Promise.all([studentAttendance(schoolId), staffAttendancePct(schoolId)]);
    // Per-class % over all marked records.
    const records = await AttendanceModel.find({ schoolId }).lean();
    const byClass = new Map<string, { present: number; total: number }>();
    for (const r of records) {
      const cn = (r.className as string) ?? '';
      const cur = byClass.get(cn) ?? { present: 0, total: 0 };
      cur.total += 1;
      if (r.status === 'present') cur.present += 1;
      byClass.set(cn, cur);
    }
    return {
      studentPct: sa.pct,
      staffPct,
      absentionToday: sa.absentToday,
      byClass: [...byClass.entries()].filter(([c]) => c).map(([className, v]) => ({ className, pct: pct(v.present, v.total) })),
    };
  },

  async reports(schoolId: string) {
    const [coll, ledger] = await Promise.all([collections(schoolId), feeService.ledger(schoolId, {})]);
    const defaulters = ledger.filter((r) => r.balance > 0).length;
    return [
      {
        id: 'collections',
        category: 'finance',
        title: 'Fee Collections',
        rows: [
          { label: 'Cash', value: String(coll.cash) },
          { label: 'Online', value: String(coll.online) },
          { label: 'Bank', value: String(coll.bank) },
          { label: 'Total', value: String(coll.total) },
        ],
      },
      {
        id: 'defaulters',
        category: 'finance',
        title: 'Fee Defaulters',
        rows: [{ label: 'Students with dues', value: String(defaulters) }],
      },
      {
        id: 'enrollment',
        category: 'academics',
        title: 'Enrollment',
        rows: [{ label: 'Active students', value: String(await StudentModel.countDocuments({ schoolId, profileStatus: 'active' })) }],
      },
    ];
  },

  // ── Approvals ──
  async approvals(schoolId: string, type?: string) {
    const filter: Record<string, unknown> = { schoolId, status: 'pending' };
    if (type) filter.type = type;
    return (await ApprovalModel.find(filter).sort({ createdAt: -1 }).lean()).map((d) => approvalView(d as Doc));
  },

  async approvalDetail(schoolId: string, id: string) {
    const d = await ApprovalModel.findOne({ _id: id, schoolId }).lean();
    if (!d) throw ApiError.notFound('Approval not found');
    return approvalView(d as Doc);
  },

  async act(
    schoolId: string,
    id: string,
    action: 'endorse' | 'authorize' | 'reject',
    reason: string,
    expectedLevel: number,
    actor: { name: string; role: string },
  ) {
    const item = await ApprovalModel.findOne({ _id: id, schoolId });
    if (!item) throw ApiError.notFound('Approval not found');
    if (item.status !== 'pending') throw ApiError.conflict('This item has already been actioned');
    if (Number(expectedLevel) !== Number(item.currentLevel)) {
      throw ApiError.conflict('This item has moved to another level — refresh and retry');
    }
    const entry: Record<string, unknown> = {
      level: item.currentLevel,
      roleLabel: actor.role,
      actorName: actor.name,
      at: nowIso(),
      reason,
    };
    if (action === 'reject') {
      item.status = 'rejected';
      entry.decision = 'rejected';
    } else if (action === 'authorize' || item.currentLevel >= (item.maxLevel ?? 2)) {
      item.status = 'approved';
      entry.decision = 'authorized';
    } else {
      item.currentLevel = Number(item.currentLevel) + 1;
      entry.decision = 'endorsed';
    }
    (item.trail as unknown[]).push(entry);
    await item.save();
    return approvalView(item.toObject() as Doc);
  },
};
