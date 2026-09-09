import { Types } from 'mongoose';

import { getActiveSessionName } from '../academics/academics.service';
import { ApiError } from '../../lib/api-error';
import { StudentModel } from '../students/student.model';
import { AppliedConcessionModel, AppliedFineModel } from './fee-extras.models';
import {
  FREQUENCY_MULTIPLIER,
  FeeHeadModel,
  FeeStructureModel,
  ReceiptModel,
} from './fee.models';

type Doc = Record<string, unknown> & { _id: unknown };

/** UI sends the 3-letter abbreviation; receipts store the full month name in `monthsCovered`. */
export const MONTH_ABBR_TO_FULL: Record<string, string> = {
  Apr: 'April', May: 'May', Jun: 'June', Jul: 'July', Aug: 'August', Sep: 'September',
  Oct: 'October', Nov: 'November', Dec: 'December', Jan: 'January', Feb: 'February', Mar: 'March',
};

/** Session runs April(0)..March(11) — shared with fee-recovery's defaulter scan. */
export const SESSION_MONTHS = [
  'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December', 'January', 'February', 'March',
] as const;

/** Calendar due-date for a session month index — the 5th of that month, mirrors the pre-existing defaulter-scan convention. */
export function monthDueDate(monthIndex: number, startYear: number): Date {
  const year = monthIndex < 9 ? startYear : startYear + 1;
  const calendarMonth = (monthIndex + 3) % 12; // April(0) -> calendar month 3
  return new Date(year, calendarMonth, 5);
}

async function nextReceiptNumber(schoolId: string): Promise<string> {
  const count = await ReceiptModel.countDocuments({ schoolId });
  return `RCP-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`;
}

function toHead(d: Doc) {
  return {
    id: String(d._id),
    name: d.name,
    type: d.type,
    description: d.description,
    isRefundable: d.isRefundable ?? false,
    isMandatory: d.isMandatory ?? true,
    order: d.order ?? 0,
  };
}
function toReceipt(d: Doc) {
  return {
    id: String(d._id),
    receiptNumber: d.receiptNumber,
    studentId: d.studentId ? String(d.studentId) : '',
    studentName: d.studentName,
    className: d.className,
    section: d.section,
    monthsCovered: d.monthsCovered ?? [],
    feeHeads: d.feeHeads ?? [],
    amount: d.amount ?? 0,
    paymentMode: d.paymentMode,
    payments: d.payments ?? [],
    waiveOff: d.waiveOff,
    paymentDate: d.paymentDate,
    generatedBy: d.generatedBy,
    status: d.status,
    cancelledReason: d.cancelledReason,
    cancelledBy: d.cancelledBy,
    cancelledAt: d.cancelledAt,
    remarks: d.remarks,
  };
}

/** Recompute and persist Student.feeStatus from actual receipts — keeps the denormalized field in sync after any collect/cancel/duplicate. */
export async function syncStudentFeeStatus(schoolId: string, studentId: string): Promise<void> {
  const student = await StudentModel.findOne({ _id: studentId, schoolId }, { className: 1 }).lean();
  if (!student) return;
  const session = await getActiveSessionName(schoolId);
  const annual = await annualByClass(schoolId, session);
  const totalFee = annual[student.className ?? ''] ?? 0;
  const receipts = await ReceiptModel.find({ schoolId, studentId, status: 'active' }, { amount: 1 }).lean();
  const paid = receipts.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  const feeStatus = paid <= 0 ? 'pending' : paid > totalFee ? 'advance' : paid >= totalFee ? 'paid' : 'partial';
  await StudentModel.updateOne({ _id: studentId, schoolId }, { $set: { feeStatus } });
}

export async function annualByClass(schoolId: string, session: string): Promise<Record<string, number>> {
  const structure = await FeeStructureModel.find({ schoolId, session }).lean();
  const out: Record<string, number> = {};
  for (const row of structure) {
    const mult = FREQUENCY_MULTIPLIER[row.frequency] ?? 1;
    for (const [cls, amt] of Object.entries((row.amounts as Record<string, number>) ?? {})) {
      out[cls] = (out[cls] ?? 0) + Number(amt) * mult;
    }
  }
  return out;
}

interface FeeHeadDef {
  id: string;
  name: string;
  monthlyAmount: number;
}

/** Every fee head applicable to a class, spread evenly across 12 months regardless of configured frequency — the one shared definition `studentContext`, `collect()`, and the ledgers all build on. */
async function feeHeadDefsForClass(schoolId: string, session: string, className: string): Promise<FeeHeadDef[]> {
  const [structure, heads] = await Promise.all([
    FeeStructureModel.find({ schoolId, session }).lean(),
    FeeHeadModel.find({ schoolId }).lean(),
  ]);
  const headMap = new Map(heads.map((h) => [String(h._id), h.name]));
  return structure
    .filter((r) => (r.amounts as Record<string, number>)?.[className] != null)
    .map((r) => {
      const configured = Number((r.amounts as Record<string, number>)[className]) || 0;
      const mult = FREQUENCY_MULTIPLIER[r.frequency as string] ?? 1;
      return {
        id: r.feeHeadId,
        name: headMap.get(r.feeHeadId) ?? r.feeHeadId,
        monthlyAmount: Math.round((configured * mult) / 12),
      };
    });
}

/**
 * Monthly value of every concession currently in effect (`approvalStatus:
 * 'active'`) for a student — flat concessions contribute their value as-is;
 * percentage concessions apply against the monthly total of their target fee
 * heads (or every head, if none are targeted). One-time, not scaled by how
 * many months a given collection covers — matches how the collection screen
 * has always applied it (a single flat reduction per transaction).
 */
async function computeConcessionAmount(schoolId: string, studentId: string, feeHeadDefs: readonly FeeHeadDef[]): Promise<number> {
  const applied = await AppliedConcessionModel.find({ schoolId, studentId, approvalStatus: 'active' }).lean();
  let total = 0;
  for (const c of applied) {
    const targetHeads = (c.appliedToHeads as string[] | undefined) ?? [];
    const base = targetHeads.length
      ? feeHeadDefs.filter((h) => targetHeads.includes(h.id)).reduce((s, h) => s + h.monthlyAmount, 0)
      : feeHeadDefs.reduce((s, h) => s + h.monthlyAmount, 0);
    const value = Number(c.value) || 0;
    total += c.calcType === 'percentage' ? Math.round((value / 100) * base) : value;
  }
  return total;
}

/** Every fine still owed (not yet paid or waived), plus the row ids so a successful collection can mark them paid. */
async function computePendingFines(schoolId: string, studentId: string): Promise<{ amount: number; ids: string[] }> {
  const pending = await AppliedFineModel.find({ schoolId, studentId, status: 'pending' }).lean();
  return {
    amount: pending.reduce((s, f) => s + Number(f.amount ?? 0), 0),
    ids: pending.map((f) => String(f._id)),
  };
}

/**
 * Arrears from months whose due date (the 5th) has already passed, still
 * unpaid — same "overdue" definition fee-recovery's defaulter scan uses.
 * `excludeMonths` leaves out whatever's being paid in the current
 * transaction, so a collection that pays off an overdue month doesn't also
 * double-count it here on top of the per-month `grossTotal` for that month.
 */
function computeOverdueArrears(
  session: string,
  monthlyTotal: number,
  paidForMonth: (month: string) => number,
  excludeMonths: ReadonlySet<string>,
): number {
  const startYear = parseInt(session.split('-')[0]!, 10) || new Date().getFullYear();
  const now = Date.now();
  let total = 0;
  SESSION_MONTHS.forEach((month, i) => {
    if (excludeMonths.has(month)) return;
    if (monthDueDate(i, startYear).getTime() > now) return; // not yet due
    total += Math.max(0, monthlyTotal - paidForMonth(month));
  });
  return total;
}

/**
 * Server-side source of truth for a collection: what each fee head is
 * actually worth for the given months, the concession/fine/arrears that
 * apply, and how much advance credit the student is carrying. Mirrors the
 * exact formula `studentContext` hands the frontend (same monthly spread,
 * same "unpaid remainder of each selected month" logic, same concession/fine
 * sourcing) so a legitimate collection's client-side total always matches
 * this recompute — never trust `feeHeads[].amount` / `netPayable` as sent,
 * they're client input.
 */
async function recomputeCollectionTotals(
  schoolId: string,
  student: { _id: unknown; className?: string },
  months: readonly string[],
): Promise<{
  perHead: Array<{ id: string; name: string; amount: number }>;
  grossTotal: number;
  advanceBalance: number;
  concessionAmount: number;
  fineAmount: number;
  fineIds: string[];
  previousDues: number;
}> {
  const studentId = String(student._id);
  const session = await getActiveSessionName(schoolId);
  const cls = student.className ?? '';
  const feeHeadDefs = await feeHeadDefsForClass(schoolId, session, cls);

  const receipts = await ReceiptModel.find({ schoolId, studentId, status: 'active' }).lean();
  const monthlyTotal = feeHeadDefs.reduce((s, h) => s + h.monthlyAmount, 0);
  const paidForMonth = (m: string): number =>
    receipts
      .filter((r) => ((r.monthsCovered as string[] | undefined) ?? []).includes(m))
      .reduce((s, r) => s + Number(r.amount ?? 0), 0);

  const perHead = feeHeadDefs.map((h) => ({
    id: h.id,
    name: h.name,
    amount: Math.round(
      months.reduce((s, m) => {
        const due = Math.max(0, monthlyTotal - paidForMonth(m));
        const ratio = monthlyTotal > 0 ? due / monthlyTotal : 0;
        return s + h.monthlyAmount * ratio;
      }, 0),
    ),
  }));
  const grossTotal = perHead.reduce((s, h) => s + h.amount, 0);

  const annual = await annualByClass(schoolId, session);
  const totalFee = annual[cls] ?? 0;
  const paidTotal = receipts.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  const advanceBalance = Math.max(0, paidTotal - totalFee);

  const concessionAmount = await computeConcessionAmount(schoolId, studentId, feeHeadDefs);
  const { amount: fineAmount, ids: fineIds } = await computePendingFines(schoolId, studentId);
  const previousDues = computeOverdueArrears(session, monthlyTotal, paidForMonth, new Set(months));

  return { perHead, grossTotal, advanceBalance, concessionAmount, fineAmount, fineIds, previousDues };
}

export const feeService = {
  // ── Fee heads ──
  async listHeads(schoolId: string) {
    const docs = await FeeHeadModel.find({ schoolId }).sort({ order: 1 }).lean();
    return docs.map(toHead);
  },
  async createHead(schoolId: string, payload: Record<string, unknown>) {
    const doc = await FeeHeadModel.create({ schoolId, ...payload });
    return toHead(doc.toObject());
  },
  async updateHead(schoolId: string, id: string, payload: Record<string, unknown>) {
    const doc = await FeeHeadModel.findOneAndUpdate({ _id: id, schoolId }, { $set: payload }, { new: true });
    if (!doc) throw ApiError.notFound('Fee head not found');
    return toHead(doc.toObject());
  },
  async removeHead(schoolId: string, id: string) {
    await FeeHeadModel.deleteOne({ _id: id, schoolId });
    return { success: true };
  },
  async reorderHeads(schoolId: string, ids: string[]) {
    await Promise.all(ids.map((id, i) => FeeHeadModel.updateOne({ _id: id, schoolId }, { order: i + 1 })));
    return { success: true };
  },

  // ── Structure ──
  async getStructure(schoolId: string) {
    const session = await getActiveSessionName(schoolId);
    const rows = await FeeStructureModel.find({ schoolId, session }).lean();
    const classes = (await StudentModel.distinct('className', { schoolId })) as string[];
    return {
      rows: rows.map((r) => ({ feeHeadId: r.feeHeadId, frequency: r.frequency, amounts: r.amounts ?? {} })),
      classes: classes.sort(),
      session,
    };
  },
  async saveStructure(schoolId: string, rows: Array<{ feeHeadId: string; frequency: string; amounts: Record<string, number> }>) {
    const session = await getActiveSessionName(schoolId);
    await Promise.all(
      rows.map((r) =>
        FeeStructureModel.updateOne(
          { schoolId, session, feeHeadId: r.feeHeadId },
          { $set: { schoolId, session, feeHeadId: r.feeHeadId, frequency: r.frequency, amounts: r.amounts } },
          { upsert: true },
        ),
      ),
    );
    return this.getStructure(schoolId);
  },
  async copyFromSession(schoolId: string) {
    // No prior session yet — returns the current structure.
    return this.getStructure(schoolId);
  },

  // ── Student fee context (pending) ──
  async studentContext(schoolId: string, studentId: string) {
    const student = await StudentModel.findOne({ _id: studentId, schoolId }).lean();
    if (!student) throw ApiError.notFound('Student not found');
    const session = await getActiveSessionName(schoolId);
    const cls = student.className ?? '';

    // Spread each head's annual contribution evenly across the 12 months —
    // matches `annualByClass` (session-total math used by admin dashboard,
    // fee ledger, and the parent portal). Previously this used the raw
    // configured `amounts[cls]` as-is regardless of frequency, so a
    // half-yearly head configured at 2000 was billed as 2000/month instead
    // of its true 2000×2/12 ≈ 333/month share — inflating every month's
    // due amount and letting one payment mark the whole month "paid".
    const feeHeads = await feeHeadDefsForClass(schoolId, session, cls);

    const annual = await annualByClass(schoolId, session);
    const totalFee = annual[cls] ?? 0;

    const receipts = await ReceiptModel.find({ schoolId, studentId, status: 'active' }).sort({ paymentDate: -1 }).lean();
    const paid = receipts.reduce((s, r) => s + (r.amount ?? 0), 0);

    const startYear = parseInt(session.split('-')[0]!, 10) || new Date().getFullYear();
    const monthlyTotal = feeHeads.reduce((s, h) => s + h.monthlyAmount, 0);
    const paidForMonth = (m: string): number =>
      receipts.filter((r) => (r.monthsCovered ?? []).includes(m)).reduce((s, r) => s + (r.amount ?? 0), 0);
    const months = SESSION_MONTHS.map((m, i) => {
      const monthPaid = paidForMonth(m);
      const status = monthPaid <= 0 ? 'pending' : monthPaid >= monthlyTotal ? 'paid' : 'partial';
      return { month: m, year: i < 9 ? startYear : startYear + 1, amount: monthlyTotal, paid: monthPaid, status };
    });

    // Nothing is selected yet at this point (the month-picker hasn't been
    // touched), so this is the full outstanding picture — see
    // recomputeCollectionTotals for how collect() narrows previousDues to
    // exclude whatever months actually get paid in a given transaction.
    const concessionAmount = await computeConcessionAmount(schoolId, studentId, feeHeads);
    const { amount: fineAmount } = await computePendingFines(schoolId, studentId);
    const previousDues = computeOverdueArrears(session, monthlyTotal, paidForMonth, new Set());

    const siblings = student.parents?.fatherMobile
      ? (
          await StudentModel.find({
            schoolId,
            'parents.fatherMobile': student.parents.fatherMobile,
            _id: { $ne: student._id },
          }).lean()
        ).map((s) => ({ id: String(s._id), name: s.name }))
      : [];

    return {
      studentId: String(student._id),
      studentName: student.name,
      admissionNumber: student.admissionNumber,
      className: cls,
      section: student.section ?? '',
      rollNumber: student.rollNumber ?? '',
      fatherName: student.fatherName ?? '',
      fatherMobile: student.parents?.fatherMobile ?? student.mobile ?? '',
      photoUrl: student.photoUrl,
      outstandingBalance: Math.max(0, totalFee - paid),
      advanceBalance: Math.max(0, paid - totalFee),
      lastPayment: receipts[0]
        ? { date: receipts[0].paymentDate ?? '', amount: receipts[0].amount ?? 0, receiptNumber: receipts[0].receiptNumber }
        : undefined,
      siblings,
      months,
      feeHeads,
      concessionAmount,
      fineAmount,
      previousDues,
    };
  },

  // ── Collection ──
  async collect(schoolId: string, payload: Record<string, unknown>, generatedBy: string) {
    const p = payload as {
      studentId: string;
      months: string[];
      netPayable: number;
      payments: Array<{ mode: string }>;
      paymentDate: string;
      waiveOffAmount?: number;
      waiveOffReason?: string;
      remarks?: string;
    };
    const student = await StudentModel.findOne({ _id: p.studentId, schoolId }).lean();
    if (!student) throw ApiError.notFound('Student not found');

    const months = Array.isArray(p.months) ? p.months : [];
    const { perHead, grossTotal, advanceBalance, concessionAmount, fineAmount, fineIds, previousDues } =
      await recomputeCollectionTotals(schoolId, student, months);

    // Matches PaymentSummaryBlock's net formula on the frontend exactly:
    // gross − concession − advance + previousDues + fine, then waive-off.
    const preWaive = grossTotal - concessionAmount - advanceBalance + previousDues + fineAmount;
    const waiveOffAmount = Math.min(Math.max(0, Number(p.waiveOffAmount) || 0), Math.max(0, preWaive));
    const netPayable = Math.max(0, Math.round(preWaive - waiveOffAmount));

    const clientNetPayable = Number(p.netPayable);
    if (!Number.isFinite(clientNetPayable) || Math.abs(netPayable - clientNetPayable) > 1) {
      throw ApiError.badRequest(
        `Recalculated total (₹${netPayable}) does not match the submitted amount (₹${Number.isFinite(clientNetPayable) ? clientNetPayable : p.netPayable}). Refresh the student and try again.`,
      );
    }

    const receiptNumber = await nextReceiptNumber(schoolId);
    const doc = await ReceiptModel.create({
      schoolId,
      receiptNumber,
      studentId: p.studentId,
      studentName: student.name ?? '—',
      className: student.className ?? '—',
      section: student.section ?? '—',
      monthsCovered: months,
      feeHeads: perHead.map((h) => ({ name: h.name, amount: h.amount })),
      amount: netPayable,
      paymentMode: p.payments[0]?.mode ?? 'cash',
      payments: p.payments,
      waiveOff: waiveOffAmount > 0 ? { amount: waiveOffAmount, reason: p.waiveOffReason ?? '—' } : undefined,
      paymentDate: p.paymentDate,
      generatedBy,
      status: 'active',
      remarks: p.remarks,
    });
    // The fines that funded fineAmount are now settled by this receipt.
    if (fineIds.length > 0) {
      await AppliedFineModel.updateMany({ _id: { $in: fineIds }, schoolId }, { $set: { status: 'paid' } });
    }
    await syncStudentFeeStatus(schoolId, p.studentId);
    return toReceipt(doc.toObject());
  },

  // ── Receipts ──
  // schoolId is undefined only for super_admin's cross-tenant Utilize tool —
  // every other caller is tenant-scoped via the controller's schoolId() helper.
  async listReceipts(schoolId: string | undefined, query: Record<string, string>) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.max(1, Number(query.pageSize) || 10);
    const filter: Record<string, unknown> = schoolId ? { schoolId } : {};
    if (query.status && query.status !== 'all') filter.status = query.status;
    if (query.mode && query.mode !== 'all') filter.paymentMode = query.mode;
    if (query.className && query.className !== 'all') filter.className = query.className;
    if (query.search?.trim()) {
      const rx = new RegExp(query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ receiptNumber: rx }, { studentName: rx }];
    }
    if (query.dateFrom) filter.paymentDate = { ...(filter.paymentDate as object), $gte: query.dateFrom };
    if (query.dateTo) filter.paymentDate = { ...(filter.paymentDate as object), $lte: query.dateTo };

    const [docs, total] = await Promise.all([
      ReceiptModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
      ReceiptModel.countDocuments(filter),
    ]);
    return { rows: docs.map(toReceipt), total, page, pageSize };
  },

  async getReceipt(schoolId: string | undefined, id: string) {
    const d = await ReceiptModel.findOne(schoolId ? { _id: id, schoolId } : { _id: id }).lean();
    if (!d) throw ApiError.notFound('Receipt not found');
    return toReceipt(d);
  },

  async duplicateReceipt(schoolId: string | undefined, id: string) {
    const original = await ReceiptModel.findOne(schoolId ? { _id: id, schoolId } : { _id: id });
    if (!original) throw ApiError.notFound('Receipt not found');
    original.status = 'duplicate_issued';
    await original.save();
    const dup = await ReceiptModel.create({
      ...original.toObject(),
      _id: undefined,
      receiptNumber: `${original.receiptNumber}-DUP`,
      status: 'active',
    });
    if (dup.schoolId && dup.studentId) await syncStudentFeeStatus(String(dup.schoolId), String(dup.studentId));
    return toReceipt(dup.toObject());
  },

  async cancelReceipt(schoolId: string | undefined, id: string, reason: string, by: string) {
    const doc = await ReceiptModel.findOneAndUpdate(
      schoolId ? { _id: id, schoolId } : { _id: id },
      { status: 'cancelled', cancelledReason: reason, cancelledBy: by, cancelledAt: new Date().toISOString() },
      { new: true },
    );
    if (!doc) throw ApiError.notFound('Receipt not found');
    if (doc.schoolId && doc.studentId) await syncStudentFeeStatus(String(doc.schoolId), String(doc.studentId));
    return toReceipt(doc.toObject());
  },

  async editReceiptRemarks(schoolId: string | undefined, id: string, remarks: string) {
    const doc = await ReceiptModel.findOneAndUpdate(
      schoolId ? { _id: id, schoolId } : { _id: id },
      { remarks },
      { new: true },
    );
    if (!doc) throw ApiError.notFound('Receipt not found');
    return toReceipt(doc.toObject());
  },

  /** Reversal = a new offsetting negative-amount receipt, original stays active untouched — a credit note, not a mutation of history. */
  async reverseReceipt(schoolId: string | undefined, id: string, reason: string, by: string) {
    const original = await ReceiptModel.findOne(schoolId ? { _id: id, schoolId } : { _id: id });
    if (!original) throw ApiError.notFound('Receipt not found');
    if (original.status !== 'active') throw ApiError.badRequest('Only an active receipt can be reversed');
    const reversalNumber = `${original.receiptNumber}-REV`;
    // The (schoolId, receiptNumber) index is unique, so a second reversal
    // would surface as a raw 11000 CONFLICT. Detect it here and repair the
    // original's status so the receipt stops looking reversible.
    const alreadyReversed = await ReceiptModel.findOne(
      original.schoolId ? { schoolId: original.schoolId, receiptNumber: reversalNumber } : { receiptNumber: reversalNumber },
    ).lean();
    if (alreadyReversed) {
      original.status = 'reversed';
      await original.save();
      throw ApiError.badRequest('This receipt has already been reversed');
    }
    const reversal = await ReceiptModel.create({
      ...original.toObject(),
      _id: undefined,
      receiptNumber: reversalNumber,
      amount: -Number(original.amount ?? 0),
      status: 'active',
      generatedBy: by,
      remarks: reason,
      payments: [],
      waiveOff: undefined,
    });
    // Mark the original reversed so it can't be reversed twice and drops out
    // of the active-only duplicate finder.
    original.status = 'reversed';
    await original.save();
    if (reversal.schoolId && reversal.studentId) await syncStudentFeeStatus(String(reversal.schoolId), String(reversal.studentId));
    return toReceipt(reversal.toObject());
  },

  async transferReceipt(schoolId: string | undefined, id: string, targetStudentId: string) {
    const doc = await ReceiptModel.findOne(schoolId ? { _id: id, schoolId } : { _id: id });
    if (!doc) throw ApiError.notFound('Receipt not found');
    const target = await StudentModel.findOne(
      schoolId ? { _id: targetStudentId, schoolId } : { _id: targetStudentId },
    ).lean();
    if (!target) throw ApiError.notFound('Target student not found');
    const previousStudentId = doc.studentId ? String(doc.studentId) : '';
    doc.set({
      studentId: targetStudentId,
      studentName: target.name,
      className: target.className ?? '',
      section: target.section ?? '',
    });
    await doc.save();
    if (doc.schoolId) {
      if (previousStudentId) await syncStudentFeeStatus(String(doc.schoolId), previousStudentId);
      await syncStudentFeeStatus(String(doc.schoolId), targetStudentId);
    }
    return toReceipt(doc.toObject());
  },

  async stats(schoolId: string) {
    const today = new Date().toISOString().slice(0, 10);
    const monthPrefix = today.slice(0, 7);
    const active = await ReceiptModel.find({ schoolId, status: 'active' }).lean();
    const todayR = active.filter((r) => (r.paymentDate ?? '').slice(0, 10) === today);
    const monthR = active.filter((r) => (r.paymentDate ?? '').slice(0, 7) === monthPrefix);
    return {
      todayCount: todayR.length,
      todayCollection: todayR.reduce((s, r) => s + (r.amount ?? 0), 0),
      monthCollection: monthR.reduce((s, r) => s + (r.amount ?? 0), 0),
    };
  },

  /** School-wide outstanding balance: sum of (class annual fee - paid) across students with dues. */
  async getTotalOutstanding(schoolId: string): Promise<{ amount: number; studentsCount: number }> {
    const session = await getActiveSessionName(schoolId);
    const annual = await annualByClass(schoolId, session);
    const [students, receipts] = await Promise.all([
      StudentModel.find({ schoolId, profileStatus: 'active' }, { className: 1 }).lean(),
      ReceiptModel.find({ schoolId, status: 'active' }, { studentId: 1, amount: 1 }).lean(),
    ]);
    const paidByStudent = new Map<string, number>();
    for (const r of receipts) {
      const key = String(r.studentId);
      paidByStudent.set(key, (paidByStudent.get(key) ?? 0) + Number(r.amount ?? 0));
    }
    let amount = 0;
    let studentsCount = 0;
    for (const s of students) {
      const totalFee = annual[s.className ?? ''] ?? 0;
      const due = Math.max(0, totalFee - (paidByStudent.get(String(s._id)) ?? 0));
      if (due > 0) {
        amount += due;
        studentsCount += 1;
      }
    }
    return { amount, studentsCount };
  },

  /** Accountant dashboard — today's collection, pending/defaulter/online counts, outstanding by class. */
  async accountantDashboard(schoolId: string) {
    const today = new Date().toISOString().slice(0, 10);
    const session = await getActiveSessionName(schoolId);
    const annual = await annualByClass(schoolId, session);
    const [students, receipts, todayReceipts] = await Promise.all([
      StudentModel.find({ schoolId, profileStatus: 'active' }, { className: 1, feeStatus: 1 }).lean(),
      ReceiptModel.find({ schoolId, status: 'active' }, { studentId: 1, amount: 1 }).lean(),
      ReceiptModel.find(
        { schoolId, status: 'active', paymentDate: { $regex: `^${today}` } },
        { amount: 1, paymentMode: 1 },
      ).lean(),
    ]);
    const paidByStudent = new Map<string, number>();
    for (const r of receipts) {
      const key = String(r.studentId);
      paidByStudent.set(key, (paidByStudent.get(key) ?? 0) + Number(r.amount ?? 0));
    }
    const byClass = new Map<string, { dues: number; amount: number }>();
    let pendingCount = 0;
    for (const s of students) {
      if (s.feeStatus === 'pending' || s.feeStatus === 'partial') pendingCount += 1;
      const className = s.className ?? 'Unassigned';
      const totalFee = annual[className] ?? 0;
      const due = Math.max(0, totalFee - (paidByStudent.get(String(s._id)) ?? 0));
      if (due > 0) {
        const cur = byClass.get(className) ?? { dues: 0, amount: 0 };
        cur.dues += 1;
        cur.amount += due;
        byClass.set(className, cur);
      }
    }
    const outstandingByClass = [...byClass.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([className, v]) => ({ className, dues: v.dues, amount: v.amount }));

    return {
      todayCollection: todayReceipts.reduce((s, r) => s + (r.amount ?? 0), 0),
      pendingCount,
      defaultersCount: outstandingByClass.reduce((s, c) => s + c.dues, 0),
      onlineCount: todayReceipts.filter((r) => r.paymentMode === 'online').length,
      outstandingByClass,
    };
  },

  // ── Student Ledger (single student, for student profile tab) ──
  async studentLedger(schoolId: string, studentId: string) {
    const student = await StudentModel.findOne({ _id: studentId, schoolId }).lean();
    if (!student) throw ApiError.notFound('Student not found');

    const session = await getActiveSessionName(schoolId);
    const cls = student.className ?? '';
    const annual = await annualByClass(schoolId, session);
    const totalFee = annual[cls] ?? 0;
    const feeHeadDefs = await feeHeadDefsForClass(schoolId, session, cls);
    const monthlyTotal = feeHeadDefs.reduce((s, h) => s + h.monthlyAmount, 0);
    const feeHeadNames = feeHeadDefs.map((h) => h.name).join(', ') || 'Fee';

    // All active receipts for this student
    const receipts = await ReceiptModel.find({
      schoolId,
      studentId: student._id,
      status: 'active',
    })
      .sort({ paymentDate: 1 })
      .lean();

    const paid = receipts.reduce((s, r) => s + Number(r.amount ?? 0), 0);
    const balance = Math.max(0, totalFee - paid);

    // One row per session month — matches how student-fee-ledger-tab.tsx
    // renders it (`key={row.month}`), not one row per past receipt (a
    // receipt's own "balance" is trivially 0 by construction, which is what
    // the old per-receipt rows always showed).
    const rows = SESSION_MONTHS.map((month) => {
      const covering = receipts.filter((r) => ((r.monthsCovered as string[] | undefined) ?? []).includes(month));
      const monthPaid = covering.reduce((s, r) => s + Number(r.amount ?? 0), 0);
      const monthBalance = Math.max(0, monthlyTotal - monthPaid);
      const status = monthPaid <= 0 ? ('pending' as const) : monthBalance > 0 ? ('partial' as const) : ('paid' as const);
      const latestReceipt = covering.reduce<(typeof covering)[number] | undefined>((latest, r) => {
        const d = (r.paymentDate as string | undefined) ?? '';
        return !latest || d >= ((latest.paymentDate as string | undefined) ?? '') ? r : latest;
      }, undefined);
      return {
        month,
        feeHead: feeHeadNames,
        amount: monthlyTotal,
        paid: monthPaid,
        balance: monthBalance,
        status,
        receiptNumber: latestReceipt?.receiptNumber as string | undefined,
      };
    });

    // Annualized to match totalFees/paid/balance, which are session totals.
    const concessionApplied = (await computeConcessionAmount(schoolId, studentId, feeHeadDefs)) * 12;

    return {
      totalFees: totalFee,
      paid,
      balance,
      concessionApplied,
      rows,
    };
  },

  // ── Ledger ──
  async ledger(schoolId: string, query: Record<string, string>) {
    const session = await getActiveSessionName(schoolId);
    const annual = await annualByClass(schoolId, session);
    const filter: Record<string, unknown> = { schoolId };
    if (query.className && query.className !== 'all') filter.className = query.className;
    if (query.section && query.section !== 'all') filter.section = query.section;
    const students = await StudentModel.find(filter).lean();
    const studentIds = students.map((s) => String(s._id));

    const receipts = await ReceiptModel.find({
      schoolId: new Types.ObjectId(schoolId),
      status: 'active',
      studentId: { $in: students.map((s) => s._id) },
    }).lean();
    const byStudent = new Map<string, typeof receipts>();
    for (const r of receipts) {
      const sid = String(r.studentId ?? '');
      const list = byStudent.get(sid) ?? [];
      list.push(r);
      byStudent.set(sid, list);
    }

    const monthFull = MONTH_ABBR_TO_FULL[query.month ?? ''];

    // Batch-fetch concession/fine data for the whole roster instead of one
    // query per student — feeHeadDefsForClass is cached per distinct class.
    const [allConcessions, allFines] = await Promise.all([
      AppliedConcessionModel.find({ schoolId, studentId: { $in: studentIds }, approvalStatus: 'active' }).lean(),
      AppliedFineModel.find({ schoolId, studentId: { $in: studentIds }, status: 'pending' }).lean(),
    ]);
    const concessionsByStudent = new Map<string, typeof allConcessions>();
    for (const c of allConcessions) {
      const sid = String(c.studentId ?? '');
      const list = concessionsByStudent.get(sid) ?? [];
      list.push(c);
      concessionsByStudent.set(sid, list);
    }
    const finesByStudent = new Map<string, typeof allFines>();
    for (const f of allFines) {
      const sid = String(f.studentId ?? '');
      const list = finesByStudent.get(sid) ?? [];
      list.push(f);
      finesByStudent.set(sid, list);
    }
    const feeHeadDefsByClass = new Map<string, FeeHeadDef[]>();
    const feeHeadDefsFor = async (className: string): Promise<FeeHeadDef[]> => {
      const cached = feeHeadDefsByClass.get(className);
      if (cached) return cached;
      const defs = await feeHeadDefsForClass(schoolId, session, className);
      feeHeadDefsByClass.set(className, defs);
      return defs;
    };
    /** Same flat/percentage math as computeConcessionAmount, against an already-fetched list. */
    const concessionValueFor = (
      applied: typeof allConcessions,
      feeHeadDefs: readonly FeeHeadDef[],
    ): number =>
      applied.reduce((total, c) => {
        const targetHeads = (c.appliedToHeads as string[] | undefined) ?? [];
        const base = targetHeads.length
          ? feeHeadDefs.filter((h) => targetHeads.includes(h.id)).reduce((s, h) => s + h.monthlyAmount, 0)
          : feeHeadDefs.reduce((s, h) => s + h.monthlyAmount, 0);
        const value = Number(c.value) || 0;
        return total + (c.calcType === 'percentage' ? Math.round((value / 100) * base) : value);
      }, 0);

    const latestOf = (list: typeof receipts): string | undefined =>
      list.reduce<string | undefined>((latest, r) => {
        const d = (r.paymentDate as string | undefined) ?? '';
        return !latest || d > latest ? d : latest;
      }, undefined);

    let rows = await Promise.all(
      students.map(async (s) => {
        const sid = String(s._id);
        const studentReceipts = byStudent.get(sid) ?? [];
        const annualFee = annual[s.className ?? ''] ?? 0;
        const feeHeadDefs = await feeHeadDefsFor(s.className ?? '');
        const studentFines = finesByStudent.get(sid) ?? [];
        const studentConcessions = concessionsByStudent.get(sid) ?? [];

        let totalFee: number;
        let paid: number;
        let lastPaymentDate: string | undefined;
        let concession: number;
        let fine: number;
        let waived: number;
        if (monthFull) {
          totalFee = Math.round(annualFee / 12);
          const monthReceipts = studentReceipts.filter((r) => ((r.monthsCovered as string[] | undefined) ?? []).includes(monthFull));
          paid = monthReceipts.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
          lastPaymentDate = latestOf(monthReceipts);
          concession = concessionValueFor(studentConcessions, feeHeadDefs);
          fine = studentFines.filter((f) => f.month === monthFull).reduce((sum, f) => sum + Number(f.amount ?? 0), 0);
          waived = monthReceipts.reduce((sum, r) => sum + Number((r.waiveOff as { amount?: number } | undefined)?.amount ?? 0), 0);
        } else {
          totalFee = annualFee;
          paid = studentReceipts.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
          lastPaymentDate = latestOf(studentReceipts);
          concession = concessionValueFor(studentConcessions, feeHeadDefs) * 12;
          fine = studentFines.reduce((sum, f) => sum + Number(f.amount ?? 0), 0);
          waived = studentReceipts.reduce((sum, r) => sum + Number((r.waiveOff as { amount?: number } | undefined)?.amount ?? 0), 0);
        }

        const netFee = Math.max(0, totalFee - concession);
        const balance = Math.max(0, netFee - paid);
        const status = paid <= 0 ? 'pending' : balance <= 0 ? 'paid' : 'partial';
        return {
          studentId: sid,
          admissionNumber: s.admissionNumber,
          studentName: s.name,
          className: s.className ?? '',
          section: s.section ?? '',
          photoUrl: s.photoUrl,
          totalFee,
          concession,
          netFee,
          paid,
          balance,
          fine,
          waived,
          status,
          lastPaymentDate,
        };
      }),
    );
    if (query.status && query.status !== 'all') rows = rows.filter((r) => r.status === query.status);
    return rows;
  },
};
