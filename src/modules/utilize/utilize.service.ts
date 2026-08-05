import { ApiError } from '../../lib/api-error';
import { feeAdjustService } from '../fee/fee-adjust.service';
import { feeService } from '../fee/fee.service';
import type { ReportData } from '../reports/reports.service';
import { StudentModel } from '../students/student.model';
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

/** Applies the real DB mutation a receipt correction represents. Only receipt corrections have one — readjustments (fine/discount/concession/…) are audit-only pending their own dedicated backends. */
async function applyReceiptMutation(
  schoolId: string | undefined,
  action: string,
  targetId: string,
  reason: string,
  newValue: Record<string, unknown> | null | undefined,
  actorName: string,
): Promise<void> {
  switch (action) {
    case 'cancel':
      await feeService.cancelReceipt(schoolId, targetId, reason, actorName);
      return;
    case 'edit':
      await feeService.editReceiptRemarks(schoolId, targetId, String(newValue?.remarks ?? ''));
      return;
    case 'reverse':
      await feeService.reverseReceipt(schoolId, targetId, reason, actorName);
      return;
    case 'regenerate':
      await feeService.duplicateReceipt(schoolId, targetId);
      return;
    case 'transfer': {
      const targetStudentId = String(newValue?.studentId ?? '');
      if (!targetStudentId) throw ApiError.badRequest('Target student is required for a transfer');
      await feeService.transferReceipt(schoolId, targetId, targetStudentId);
      return;
    }
    default:
      return;
  }
}

/**
 * Fee readjustments (fine/discount/concession/…) mirror how fee-adjust's own
 * "readjustment" feature already works elsewhere in the app — an audit-log
 * record, not a ledger mutation (real fee changes go through Receipt
 * corrections, WaiveOff, or the dedicated Fine/Concession models). This
 * writes into that SAME real ReadjustmentModel so it shows up in
 * getReadjustmentHistory too, instead of only existing inside Utilize's own
 * disconnected CorrectionModel record.
 */
async function applyReadjustment(
  studentId: string,
  type: string,
  oldValue: Record<string, unknown> | null | undefined,
  newValue: Record<string, unknown> | null | undefined,
  reason: string,
  actor: { name: string; ip: string },
): Promise<void> {
  const student = await StudentModel.findById(studentId).select('schoolId studentName name className').lean();
  if (!student?.schoolId) throw ApiError.notFound('Student not found');
  const oldStr = String(oldValue?.value ?? '');
  const newStr = String(newValue?.value ?? '');
  const oldNum = Number(oldStr);
  const newNum = Number(newStr);
  const difference = !Number.isNaN(oldNum) && !Number.isNaN(newNum) ? String(newNum - oldNum) : '';
  await feeAdjustService.createReadjustment(String(student.schoolId), type, actor, {
    studentName: student.name,
    className: student.className,
    oldValue: oldStr,
    newValue: newStr,
    difference,
    reason,
  });
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

  /**
   * Student lookup for Fee Readjustment. The regular /api/students list is
   * gated to tenant admin roles only and requires a fixed schoolId, so it
   * 403s (or throws "no school scope") for super_admin/support_engineer —
   * this mirrors searchReceipts' cross-tenant-capable pattern instead.
   */
  async searchStudents(schoolId: string | undefined, q: string) {
    const term = q.trim();
    if (!term) return [];
    const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const filter: Record<string, unknown> = {
      $or: [{ name: rx }, { admissionNumber: rx }, { mobile: rx }],
    };
    if (schoolId) filter.schoolId = schoolId;
    const docs = await StudentModel.find(filter).limit(8).lean();
    return docs.map((d) => ({
      id: String(d._id),
      admissionNumber: d.admissionNumber,
      name: d.name,
      className: d.className ?? '',
      section: d.section ?? '',
      photoUrl: d.photoUrl,
    }));
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
    const category = String(payload.category);
    const direct = canApplyDirectly(actor.role, action, amount);
    const now = nowIso();
    const targetId = String(payload.targetId ?? payload.recordRef ?? '');

    // Apply the real mutation first when direct — if it throws, nothing is
    // logged as "applied" that never actually happened to the underlying
    // record. Queued (non-direct) corrections apply later, at approval time.
    if (direct && category === 'receipt') {
      await applyReceiptMutation(
        schoolId,
        action,
        targetId,
        String(payload.reason ?? ''),
        payload.newValue as Record<string, unknown> | null | undefined,
        actor.name,
      );
    } else if (direct && category === 'readjustment') {
      await applyReadjustment(
        String(payload.studentId),
        action,
        payload.oldValue as Record<string, unknown> | null | undefined,
        payload.newValue as Record<string, unknown> | null | undefined,
        String(payload.reason ?? ''),
        { name: actor.name, ip: actor.ip },
      );
    }

    const doc = await CorrectionModel.create({
      schoolId,
      timestamp: now,
      operator: actor.name,
      role: actor.role,
      category: payload.category,
      action,
      recordRef: payload.recordRef,
      targetId,
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

    return view(doc.toObject() as Doc);
  },

  async getApprovalQueue(schoolId: string | undefined, status?: string) {
    const filter: Record<string, unknown> = schoolId ? { schoolId } : {};
    if (status && status !== 'all') filter.status = status;
    else if (!status) filter.status = 'pending_approval';
    return (await CorrectionModel.find(filter).sort({ timestamp: -1 }).lean()).map((d) => view(d as unknown as Doc));
  },

  async approveCorrection(schoolId: string | undefined, id: string, remarks: string, actor: { name: string; ip?: string }) {
    const doc = await CorrectionModel.findOne(schoolId ? { _id: id, schoolId } : { _id: id });
    if (!doc) throw ApiError.notFound('Correction not found');
    if (doc.status !== 'pending_approval') throw ApiError.badRequest(`Correction is already ${doc.status}`);

    // Apply the real mutation first — if it throws, the correction stays
    // pending_approval instead of being marked applied with no real effect.
    if (doc.category === 'receipt') {
      const targetId = String(doc.targetId || doc.recordRef);
      await applyReceiptMutation(
        schoolId,
        String(doc.action),
        targetId,
        String(doc.reason ?? ''),
        (doc.newValue as Record<string, unknown> | null) ?? null,
        actor.name,
      );
    } else if (doc.category === 'readjustment') {
      await applyReadjustment(
        String(doc.studentId),
        String(doc.action),
        (doc.oldValue as Record<string, unknown> | null) ?? null,
        (doc.newValue as Record<string, unknown> | null) ?? null,
        String(doc.reason ?? ''),
        { name: actor.name, ip: actor.ip ?? '' },
      );
    }

    const now = nowIso();
    const reason = remarks.trim() ? `${doc.reason} — ${remarks.trim()}` : doc.reason;
    doc.set({ status: 'applied', approvedBy: actor.name, approvedAt: now, reason });
    await doc.save();

    return view(doc.toObject() as Doc);
  },

  async rejectCorrection(schoolId: string | undefined, id: string, reason: string) {
    const existing = await CorrectionModel.findOne(schoolId ? { _id: id, schoolId } : { _id: id }).select('status').lean();
    if (!existing) throw ApiError.notFound('Correction not found');
    if (existing.status !== 'pending_approval') throw ApiError.badRequest(`Correction is already ${existing.status}`);

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

  async exportAuditLog(
    schoolId: string | undefined,
    query: { type?: string; operator?: string; student?: string; status?: string; dateFrom?: string; dateTo?: string },
  ): Promise<ReportData> {
    const rows = await this.getAuditLog(schoolId, query);
    return {
      title: 'Correction audit log',
      subtitle: `${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}`,
      columns: ['Timestamp', 'Operator', 'Role', 'Type', 'Record', 'Student', 'Old value', 'New value', 'Reason', 'Status', 'Approved by'],
      rows: rows.map((r) => [
        String(r.timestamp ?? ''),
        String(r.operator ?? ''),
        String(r.role ?? ''),
        String(r.action ?? ''),
        String(r.recordRef ?? ''),
        String(r.studentName ?? ''),
        fmtValue(r.oldValue as Record<string, unknown> | null),
        fmtValue(r.newValue as Record<string, unknown> | null),
        String(r.reason ?? ''),
        String(r.status ?? ''),
        String(r.approvedBy ?? ''),
      ]),
    };
  },
};

function fmtValue(v: Record<string, unknown> | null): string {
  if (!v) return '';
  return Object.entries(v).map(([k, val]) => `${k}: ${String(val)}`).join(', ');
}
