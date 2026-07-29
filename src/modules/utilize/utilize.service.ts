import { ApiError } from '../../lib/api-error';
import { feeService } from '../fee/fee.service';
import { CorrectionModel } from './utilize.models';

type Doc = Record<string, unknown> & { _id: unknown };
const nowIso = (): string => new Date().toISOString();

/** Types that always require approval regardless of amount — mirrors the frontend's SENSITIVE_CORRECTION_TYPES. */
const SENSITIVE_CORRECTION_TYPES = ['concession', 'discount'];
const CORRECTION_APPROVAL_THRESHOLD = 5000;

/** Whether the operator may apply the correction directly. Super Admin is the approver and always applies directly. */
function canApplyDirectly(role: string | undefined, action: string, amount: number): boolean {
  if (role === 'super_admin') return true;
  if (SENSITIVE_CORRECTION_TYPES.includes(action)) return false;
  return Math.abs(amount) <= CORRECTION_APPROVAL_THRESHOLD;
}

function view(d: Doc): Record<string, unknown> {
  return {
    id: String(d._id),
    timestamp: d.timestamp,
    operator: d.operator,
    role: d.role,
    category: d.category,
    action: d.action,
    recordRef: d.recordRef,
    studentId: d.studentId,
    studentName: d.studentName,
    oldValue: d.oldValue ?? null,
    newValue: d.newValue ?? null,
    reasonCode: d.reasonCode,
    reason: d.reason,
    status: d.status,
    requestedBy: d.requestedBy,
    approvedBy: d.approvedBy,
    approvedAt: d.approvedAt,
    rejectedReason: d.rejectedReason,
    ipAddress: d.ipAddress,
  };
}

export const utilizeService = {
  // super_admin gets cross-tenant scope (schoolId undefined); everyone else is tenant-scoped.
  async searchReceipts(schoolId: string | undefined, q: string) {
    const { rows } = await feeService.listReceipts(schoolId, { page: '1', pageSize: '100000', status: 'all', search: q });
    return rows;
  },

  async getDuplicates(schoolId: string | undefined) {
    const { rows } = await feeService.listReceipts(schoolId, { page: '1', pageSize: '100000', status: 'active' });
    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = `${r.studentId}|${r.amount}|${String(r.paymentDate).slice(0, 10)}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    const dupes: Record<string, unknown>[] = [];
    for (const [key, list] of groups) {
      if (list.length < 2) continue;
      const [studentId, amount, date] = key.split('|');
      dupes.push({
        studentId,
        studentName: list[0]!.studentName,
        amount: Number(amount),
        date,
        receipts: list.map((r) => ({ id: r.id, receiptNumber: r.receiptNumber })),
      });
    }
    return dupes;
  },

  async submitCorrection(
    schoolId: string | undefined,
    actor: { name: string; role: string; ip: string },
    payload: Record<string, unknown>,
  ) {
    const amount = Number(payload.amount ?? 0);
    const action = String(payload.action);
    const direct = canApplyDirectly(actor.role, action, amount);
    const now = nowIso();

    const doc = await CorrectionModel.create({
      schoolId,
      timestamp: now,
      operator: actor.name,
      role: actor.role,
      category: payload.category,
      action,
      recordRef: payload.recordRef,
      studentId: payload.studentId,
      studentName: payload.studentName,
      oldValue: payload.oldValue ?? null,
      newValue: payload.newValue ?? null,
      reasonCode: payload.reasonCode,
      reason: payload.reason,
      status: direct ? 'applied' : 'pending_approval',
      requestedBy: actor.name,
      approvedBy: direct ? actor.name : undefined,
      approvedAt: direct ? now : undefined,
      ipAddress: actor.ip,
    });

    // Cancel also flips the underlying receipt status (never deletes it).
    if (payload.category === 'receipt' && action === 'cancel' && direct) {
      await feeService.cancelReceipt(schoolId, String(payload.recordRef), String(payload.reason), actor.name);
    }

    return view(doc.toObject() as Doc);
  },

  async getApprovalQueue(schoolId: string | undefined, status?: string) {
    const filter: Record<string, unknown> = schoolId ? { schoolId } : {};
    if (status && status !== 'all') filter.status = status;
    else if (!status) filter.status = 'pending_approval';
    return (await CorrectionModel.find(filter).sort({ timestamp: -1 }).lean()).map((d) => view(d as unknown as Doc));
  },

  async approveCorrection(schoolId: string | undefined, id: string, remarks: string, actor: { name: string }) {
    const doc = await CorrectionModel.findOne(schoolId ? { _id: id, schoolId } : { _id: id });
    if (!doc) throw ApiError.notFound('Correction not found');
    const now = nowIso();
    const reason = remarks.trim() ? `${doc.reason} — ${remarks.trim()}` : doc.reason;
    doc.set({ status: 'applied', approvedBy: actor.name, approvedAt: now, reason });
    await doc.save();

    if (doc.category === 'receipt' && doc.action === 'cancel') {
      await feeService.cancelReceipt(schoolId, String(doc.recordRef), String(doc.reason), actor.name);
    }

    return view(doc.toObject() as Doc);
  },

  async rejectCorrection(schoolId: string | undefined, id: string, reason: string) {
    const doc = await CorrectionModel.findOneAndUpdate(
      schoolId ? { _id: id, schoolId } : { _id: id },
      { $set: { status: 'rejected', rejectedReason: reason } },
      { new: true },
    );
    if (!doc) throw ApiError.notFound('Correction not found');
    return view(doc.toObject() as Doc);
  },

  async getAuditLog(
    schoolId: string | undefined,
    query: { type?: string; operator?: string; student?: string; status?: string; dateFrom?: string; dateTo?: string },
  ) {
    const filter: Record<string, unknown> = schoolId ? { schoolId } : {};
    if (query.type && query.type !== 'all') filter.action = query.type;
    if (query.status && query.status !== 'all') filter.status = query.status;
    if (query.operator) filter.operator = new RegExp(query.operator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (query.student) filter.studentName = new RegExp(query.student.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    const rows = await CorrectionModel.find(filter).sort({ timestamp: -1 }).lean();
    return rows
      .filter((c) => {
        const when = String(c.timestamp).slice(0, 10);
        if (query.dateFrom && when < query.dateFrom) return false;
        if (query.dateTo && when > query.dateTo) return false;
        return true;
      })
      .map((d) => view(d as unknown as Doc));
  },
};
