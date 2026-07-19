import { ApiError } from '../../lib/api-error';
import { AppliedConcessionModel, AppliedFineModel } from './fee-extras.models';
import { ReadjustmentModel, WaiveOffModel } from './fee-adjust.models';
import { ReceiptModel } from './fee.models';
import { feeService } from './fee.service';

type Doc = Record<string, unknown> & { _id: unknown };
const nowIso = (): string => new Date().toISOString();

function readjustmentView(d: Doc): Record<string, unknown> {
  return {
    id: String(d._id),
    type: d.type,
    date: d.date,
    studentName: d.studentName,
    targetStudentName: d.targetStudentName,
    className: d.className,
    oldValue: d.oldValue,
    newValue: d.newValue,
    difference: d.difference,
    reason: d.reason,
    performedBy: d.performedBy,
    ipAddress: d.ipAddress,
  };
}

function waiveOffView(d: Doc): Record<string, unknown> {
  return {
    id: String(d._id),
    studentId: d.studentId,
    studentName: d.studentName,
    className: d.className,
    type: d.type,
    heads: d.heads ?? [],
    amount: d.amount,
    reasonCode: d.reasonCode,
    reason: d.reason,
    requestedBy: d.requestedBy,
    requestedAt: d.requestedAt,
    status: d.status,
    approvedBy: d.approvedBy,
    approvedAt: d.approvedAt,
    appliedAt: d.appliedAt,
    rejectedReason: d.rejectedReason,
    reference: d.reference,
    ipAddress: d.ipAddress,
  };
}

export const feeAdjustService = {
  // ─── Readjustments ───
  async createReadjustment(schoolId: string, type: string, actor: { name: string; ip: string }, payload: Record<string, unknown>) {
    const doc = await ReadjustmentModel.create({
      schoolId,
      type,
      date: nowIso(),
      studentName: payload.studentName,
      targetStudentName: payload.targetStudentName,
      className: payload.className,
      oldValue: payload.oldValue,
      newValue: payload.newValue,
      difference: payload.difference,
      reason: payload.reason,
      performedBy: actor.name,
      ipAddress: actor.ip,
    });
    return readjustmentView(doc.toObject() as Doc);
  },

  async getReadjustmentHistory(schoolId: string) {
    return (await ReadjustmentModel.find({ schoolId }).sort({ date: -1 }).lean()).map((d) => readjustmentView(d as unknown as Doc));
  },

  // ─── Waive-off ───
  async requestWaiveOff(schoolId: string, actor: { name: string; ip: string }, payload: Record<string, unknown>) {
    const now = nowIso();
    const selfApprove = payload.selfApprove === true;
    const doc = await WaiveOffModel.create({
      schoolId,
      studentId: payload.studentId,
      studentName: payload.studentName,
      className: payload.className,
      type: payload.type,
      heads: payload.heads ?? [],
      amount: Number(payload.amount ?? 0),
      reasonCode: payload.reasonCode,
      reason: payload.reason,
      requestedBy: actor.name,
      requestedAt: now,
      status: selfApprove ? 'applied' : 'pending_approval',
      approvedBy: selfApprove ? actor.name : undefined,
      approvedAt: selfApprove ? now : undefined,
      appliedAt: selfApprove ? now : undefined,
      ipAddress: actor.ip,
    });
    return waiveOffView(doc.toObject() as Doc);
  },

  async getWaiveOffQueue(schoolId: string, status?: string) {
    const filter: Record<string, unknown> = { schoolId };
    if (status && status !== 'all') filter.status = status;
    return (await WaiveOffModel.find(filter).sort({ requestedAt: -1 }).lean()).map((d) => waiveOffView(d as unknown as Doc));
  },

  async approveWaiveOff(schoolId: string, id: string, remarks: string, actor: { name: string }) {
    const doc = await WaiveOffModel.findOne({ _id: id, schoolId });
    if (!doc) throw ApiError.notFound('Waive-off not found');
    const now = nowIso();
    const reason = remarks.trim() ? `${doc.reason} — ${remarks.trim()}` : doc.reason;
    doc.set({ status: 'applied', approvedBy: actor.name, approvedAt: now, appliedAt: now, reason });
    await doc.save();
    return waiveOffView(doc.toObject() as Doc);
  },

  async rejectWaiveOff(schoolId: string, id: string, reason: string) {
    const doc = await WaiveOffModel.findOneAndUpdate(
      { _id: id, schoolId },
      { $set: { status: 'rejected', rejectedReason: reason } },
      { new: true },
    );
    if (!doc) throw ApiError.notFound('Waive-off not found');
    return waiveOffView(doc.toObject() as Doc);
  },

  async getWaiveOffHistory(schoolId: string, dateFrom?: string, dateTo?: string) {
    const rows = await WaiveOffModel.find({ schoolId, status: 'applied' }).sort({ appliedAt: -1 }).lean();
    return rows
      .filter((w) => {
        const when = String(w.appliedAt ?? w.requestedAt).slice(0, 10);
        if (dateFrom && when < dateFrom) return false;
        if (dateTo && when > dateTo) return false;
        return true;
      })
      .map((d) => waiveOffView(d as unknown as Doc));
  },

  // ─── Composed reports ───
  async generateReport(schoolId: string, type: string, params: Record<string, string>) {
    const activeReceipts = async () => ReceiptModel.find({ schoolId, status: 'active' }).sort({ paymentDate: -1 }).lean();

    if (type === 'daily') {
      const rows = (await activeReceipts()).slice(0, 50);
      return {
        title: 'Daily Collection',
        columns: ['Receipt', 'Student', 'Mode', 'Amount'],
        rows: rows.map((r) => [r.receiptNumber, r.studentName, r.paymentMode, r.amount]),
        totals: ['', '', 'Total', rows.reduce((s, r) => s + Number(r.amount ?? 0), 0)],
      };
    }

    if (type === 'defaulters') {
      const ledger = await feeService.ledger(schoolId, {});
      const rows = ledger.filter((r) => r.balance > 0);
      return {
        title: 'Defaulter Report',
        columns: ['Adm. No.', 'Student', 'Class', 'Balance'],
        rows: rows.map((r) => [r.admissionNumber, r.studentName, r.className, r.balance]),
        totals: ['', '', 'Total', rows.reduce((s, r) => s + r.balance, 0)],
      };
    }

    if (type === 'monthly') {
      const ledger = await feeService.ledger(schoolId, {});
      const byClass = new Map<string, { paid: number; pending: number; total: number }>();
      for (const r of ledger) {
        const cur = byClass.get(r.className) ?? { paid: 0, pending: 0, total: 0 };
        cur.paid += r.paid;
        cur.pending += r.balance;
        cur.total += r.totalFee;
        byClass.set(r.className, cur);
      }
      return {
        title: 'Monthly Summary',
        columns: ['Class', 'Paid', 'Pending', 'Total'],
        rows: [...byClass.entries()].map(([c, v]) => [c, v.paid, v.pending, v.total]),
      };
    }

    if (type === 'cancellations') {
      const rows = await ReceiptModel.find({ schoolId, status: 'cancelled' }).lean();
      return {
        title: 'Cancelled receipts',
        columns: ['Receipt', 'Student', 'Cancelled by', 'Reason'],
        rows: rows.map((r) => [r.receiptNumber, r.studentName, r.cancelledBy ?? '—', r.cancelledReason ?? '—']),
      };
    }

    if (type === 'waive-off') {
      const applied = await WaiveOffModel.find({ schoolId, status: 'applied' }).lean();
      const byReason = new Map<string, { count: number; amount: number }>();
      for (const w of applied) {
        const cur = byReason.get(w.reasonCode as string) ?? { count: 0, amount: 0 };
        cur.count += 1;
        cur.amount += Number(w.amount ?? 0);
        byReason.set(w.reasonCode as string, cur);
      }
      return {
        title: 'Fee Waive-Off',
        columns: ['Reason', 'Count', 'Amount'],
        rows: [...byReason.entries()].map(([reason, v]) => [reason, v.count, v.amount]),
        totals: ['Total', applied.length, applied.reduce((s, w) => s + Number(w.amount ?? 0), 0)],
      };
    }

    if (type === 'fines') {
      const fines = await AppliedFineModel.find({ schoolId }).lean();
      const collected = fines.filter((f) => f.status !== 'waived').reduce((s, f) => s + Number(f.amount ?? 0), 0);
      const waived = fines.filter((f) => f.status === 'waived').reduce((s, f) => s + Number(f.amount ?? 0), 0);
      return {
        title: 'Fine Collection',
        columns: ['Metric', 'Amount'],
        rows: [['Collected', collected], ['Waived', waived]],
        totals: ['Total applied', collected + waived],
      };
    }

    if (type === 'concessions') {
      const applied = await AppliedConcessionModel.find({ schoolId }).lean();
      const byCat = new Map<string, { count: number; value: number }>();
      for (const c of applied) {
        const key = (c.category as string) ?? (c.concessionName as string) ?? 'other';
        const cur = byCat.get(key) ?? { count: 0, value: 0 };
        cur.count += 1;
        cur.value += Number(c.value ?? 0);
        byCat.set(key, cur);
      }
      return {
        title: 'Concessions',
        columns: ['Category', 'Students', 'Value'],
        rows: [...byCat.entries()].map(([cat, v]) => [cat, v.count, v.value]),
      };
    }

    if (type === 'scroll' || type === 'collection-summary') {
      const isSingle = type === 'scroll';
      const date = (params.date ?? '').slice(0, 10);
      const rows = (await activeReceipts()).filter((r) => {
        const d = String(r.paymentDate ?? '').slice(0, 10);
        if (isSingle) return d === date;
        if (params.dateFrom && d < params.dateFrom) return false;
        if (params.dateTo && d > params.dateTo) return false;
        return true;
      });
      const byMode = new Map<string, { total: number; count: number }>();
      for (const r of rows) {
        const mode = (r.paymentMode as string) ?? 'cash';
        const cur = byMode.get(mode) ?? { total: 0, count: 0 };
        cur.total += Number(r.amount ?? 0);
        cur.count += 1;
        byMode.set(mode, cur);
      }
      const grand = [...byMode.values()].reduce((s, v) => s + v.total, 0);
      const count = [...byMode.values()].reduce((s, v) => s + v.count, 0);
      return {
        title: isSingle ? 'Daily Scroll Report' : 'Collection Summary',
        columns: ['Mode', 'Amount', 'Txns'],
        rows: [...byMode.entries()].map(([m, v]) => [m, v.total, v.count]),
        totals: ['Total', grand, count],
      };
    }

    // ledger fallback (also covers variance/deposits which need cash-scroll sessions not modelled here)
    const ledger = await feeService.ledger(schoolId, {});
    return {
      title: 'Class Ledger',
      columns: ['Adm. No.', 'Student', 'Total', 'Paid', 'Balance'],
      rows: ledger.slice(0, 50).map((r) => [r.admissionNumber, r.studentName, r.totalFee, r.paid, r.balance]),
    };
  },
};
