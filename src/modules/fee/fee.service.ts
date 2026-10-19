import { Types } from 'mongoose';

import { getActiveSessionName } from '../academics/academics.service';
import { ApiError } from '../../lib/api-error';
import { StudentModel } from '../students/student.model';
import { StudentTransportModel } from '../transport/transport.models';
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

/**
 * How much of `month` has actually been paid, across a set of receipts.
 * Uses each receipt's `monthAllocations` (how its amount splits across the
 * months it covers) rather than crediting the receipt's full amount to every
 * one of its covered months — a receipt spanning N months must not make each
 * of those N months individually look like it received the whole payment.
 * Legacy receipts with no allocations fall back to an even split across
 * `monthsCovered`, which is still far closer to the truth than full credit.
 */
function buildPaidForMonth(receipts: readonly Record<string, unknown>[]): (month: string) => number {
  const totals = new Map<string, number>();
  for (const r of receipts) {
    const allocations = (r.monthAllocations as Array<{ month?: string; amount?: number }> | undefined) ?? [];
    if (allocations.length > 0) {
      for (const a of allocations) {
        if (!a.month) continue;
        totals.set(a.month, (totals.get(a.month) ?? 0) + Number(a.amount ?? 0));
      }
      continue;
    }
    const months = (r.monthsCovered as string[] | undefined) ?? [];
    if (months.length === 0) continue;
    const share = Number(r.amount ?? 0) / months.length;
    for (const m of months) totals.set(m, (totals.get(m) ?? 0) + share);
  }
  return (month: string) => totals.get(month) ?? 0;
}

/**
 * How much of what's been paid is actually attributed to a real month's due,
 * capped at that month's own `monthlyTotal` (a month can't "absorb" more than
 * its own due). `paidTotal − this` is genuine floating credit — money paid
 * that hasn't settled any specific month yet. Replaces the old `paidTotal −
 * totalFee` advance formula, which compared total cash against the whole
 * year's target regardless of which specific months that cash was ever
 * recorded against — so a family who prepaid a few months heavily while
 * other months sat completely unpaid could show a large "Advance" and large
 * "Previous dues" at the same time, and the advance would never shrink no
 * matter how it got used, since it was never tied to the per-month ledger.
 */
function totalAllocated(paidForMonth: (month: string) => number, monthlyTotal: number): number {
  return SESSION_MONTHS.reduce((s, m) => s + Math.min(monthlyTotal, Math.max(0, paidForMonth(m))), 0);
}

/**
 * Splits `netAmount` across `monthsCovered` proportionally to each month's
 * own raw due (`rawDueByMonth`), with the rounding remainder folded into the
 * last month so the allocations always sum to exactly `netAmount`. Used so
 * `collect()` can store a real per-month breakdown instead of letting every
 * covered month claim the receipt's full amount (see `buildPaidForMonth`).
 */
function allocateAcrossMonths(
  monthsCovered: readonly string[],
  rawDueByMonth: ReadonlyMap<string, number>,
  netAmount: number,
): Array<{ month: string; amount: number }> {
  if (monthsCovered.length === 0) return [];
  const rawTotal = monthsCovered.reduce((s, m) => s + (rawDueByMonth.get(m) ?? 0), 0);
  if (rawTotal <= 0) {
    // No raw due at all (e.g. the whole amount is a fine) — nothing to allocate to months.
    return [];
  }
  const allocations = monthsCovered.map((m) => ({
    month: m,
    amount: Math.round((netAmount * (rawDueByMonth.get(m) ?? 0)) / rawTotal),
  }));
  const allocated = allocations.reduce((s, a) => s + a.amount, 0);
  const remainder = Math.round(netAmount) - allocated;
  if (remainder !== 0 && allocations.length > 0) {
    allocations[allocations.length - 1]!.amount += remainder;
  }
  return allocations;
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
    monthAllocations: d.monthAllocations ?? [],
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
    reversedAt: d.reversedAt,
    remarks: d.remarks,
  };
}

/** Puts fines this receipt settled back to 'pending' — used when a receipt is cancelled or reversed. */
async function restoreFines(schoolId: string | undefined, fineIds: unknown[] | undefined): Promise<void> {
  if (!fineIds || fineIds.length === 0) return;
  await AppliedFineModel.updateMany(
    { _id: { $in: fineIds }, ...(schoolId ? { schoolId } : {}) },
    { $set: { status: 'pending' } },
  );
}

/** Recompute and persist Student.feeStatus from actual receipts — keeps the denormalized field in sync after any collect/cancel/duplicate. */
export async function syncStudentFeeStatus(schoolId: string, studentId: string): Promise<void> {
  const student = await StudentModel.findOne({ _id: studentId, schoolId }, { className: 1 }).lean();
  if (!student) return;
  const session = await getActiveSessionName(schoolId);
  const { totalFee } = await studentFeeContext(schoolId, session, student.className ?? '', studentId);
  const receipts = await ReceiptModel.find({ schoolId, studentId, status: 'active' }, { amount: 1 }).lean();
  const paid = receipts.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  const feeStatus = paid <= 0 ? 'pending' : paid > totalFee ? 'advance' : paid >= totalFee ? 'paid' : 'partial';
  await StudentModel.updateOne({ _id: studentId, schoolId }, { $set: { feeStatus } });
}

/**
 * Transport is billed per the student's assigned route, not per class — two
 * students in the same class can ride (or not ride) different routes at
 * different fares. A "Transport Fee" row in FeeStructure.amounts is
 * therefore never read for billing; `StudentTransportModel.monthlyFee`
 * (snapshotted from `Route.monthlyFee` when the student was assigned, see
 * transport.service.ts) is the only source of truth. Returns only students
 * who actually have a route assignment — no assignment means no transport
 * charge, regardless of what class-wide amount might still be configured.
 */
export async function transportFeeByStudent(schoolId: string, studentIds?: readonly string[]): Promise<Map<string, number>> {
  const filter: Record<string, unknown> = { schoolId };
  if (studentIds) filter.studentId = { $in: studentIds };
  const assignments = await StudentTransportModel.find(filter, { studentId: 1, monthlyFee: 1 }).lean();
  return new Map(assignments.map((a) => [String(a.studentId), Number(a.monthlyFee) || 0]));
}

async function transportHeadName(schoolId: string): Promise<string> {
  const head = await FeeHeadModel.findOne({ schoolId, type: 'transport' }).lean();
  return head?.name ?? 'Transport Fee';
}

async function transportHeadIds(schoolId: string): Promise<Set<string>> {
  const heads = await FeeHeadModel.find({ schoolId, type: 'transport' }, { _id: 1 }).lean();
  return new Set(heads.map((h) => String(h._id)));
}

/** Annual total per class, excluding transport — transport is route-based and computed per student, never folded into a class-wide figure. */
export async function annualByClass(schoolId: string, session: string): Promise<Record<string, number>> {
  const [structure, excludeIds] = await Promise.all([
    FeeStructureModel.find({ schoolId, session }).lean(),
    transportHeadIds(schoolId),
  ]);
  const out: Record<string, number> = {};
  for (const row of structure) {
    if (excludeIds.has(row.feeHeadId)) continue;
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

/** Every non-transport fee head applicable to a class, spread evenly across 12 months regardless of configured frequency. Transport is deliberately excluded here — see `feeHeadDefsForStudent`, which adds it back per student from their route assignment. */
async function feeHeadDefsForClass(schoolId: string, session: string, className: string): Promise<FeeHeadDef[]> {
  const [structure, heads] = await Promise.all([
    FeeStructureModel.find({ schoolId, session }).lean(),
    FeeHeadModel.find({ schoolId }).lean(),
  ]);
  const headMap = new Map(heads.map((h) => [String(h._id), h.name]));
  const excludeIds = new Set(heads.filter((h) => h.type === 'transport').map((h) => String(h._id)));
  return structure
    .filter((r) => !excludeIds.has(r.feeHeadId) && (r.amounts as Record<string, number>)?.[className] != null)
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
 * The actual per-student billing context: every class-wide fee head plus —
 * if and only if the student has a route assignment — their own route's
 * transport fee. `totalFee` likewise adds the student's annual transport
 * (monthlyFee × 12) on top of the class annual total (which never includes
 * transport, see `annualByClass`).
 */
async function studentFeeContext(
  schoolId: string,
  session: string,
  className: string,
  studentId: string,
): Promise<{ feeHeadDefs: FeeHeadDef[]; totalFee: number }> {
  const [classDefs, annual, transportFee] = await Promise.all([
    feeHeadDefsForClass(schoolId, session, className),
    annualByClass(schoolId, session),
    transportFeeByStudent(schoolId, [studentId]).then((m) => m.get(studentId) ?? 0),
  ]);
  const feeHeadDefs = transportFee > 0
    ? [...classDefs, { id: 'transport', name: await transportHeadName(schoolId), monthlyAmount: transportFee }]
    : classDefs;
  const totalFee = (annual[className] ?? 0) + transportFee * 12;
  return { feeHeadDefs, totalFee };
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
 * Also returns which months made up the total — `collect()` folds them into
 * the receipt's `monthsCovered` so this arrears figure doesn't get billed
 * again on the next visit (it used to: paying `previousDues` moved money but
 * left every overdue month's own `paidForMonth` unchanged, so the exact same
 * arrears recomputed on the very next collection).
 */
function computeOverdueArrears(
  session: string,
  monthlyTotal: number,
  paidForMonth: (month: string) => number,
  excludeMonths: ReadonlySet<string>,
): { total: number; months: string[] } {
  const startYear = parseInt(session.split('-')[0]!, 10) || new Date().getFullYear();
  const now = Date.now();
  let total = 0;
  const months: string[] = [];
  SESSION_MONTHS.forEach((month, i) => {
    if (excludeMonths.has(month)) return;
    if (monthDueDate(i, startYear).getTime() > now) return; // not yet due
    const due = Math.max(0, monthlyTotal - paidForMonth(month));
    if (due > 0) {
      total += due;
      months.push(month);
    }
  });
  return { total, months };
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
  previousDuesMonths: string[];
  rawDueByMonth: Map<string, number>;
}> {
  const studentId = String(student._id);
  const session = await getActiveSessionName(schoolId);
  const cls = student.className ?? '';
  const { feeHeadDefs, totalFee } = await studentFeeContext(schoolId, session, cls, studentId);

  const receipts = await ReceiptModel.find({ schoolId, studentId, status: 'active' }).lean();
  const monthlyTotal = feeHeadDefs.reduce((s, h) => s + h.monthlyAmount, 0);
  const paidForMonth = buildPaidForMonth(receipts);
  const rawDue = (m: string): number => Math.max(0, monthlyTotal - paidForMonth(m));

  const perHead = feeHeadDefs.map((h) => ({
    id: h.id,
    name: h.name,
    amount: Math.round(
      months.reduce((s, m) => {
        const ratio = monthlyTotal > 0 ? rawDue(m) / monthlyTotal : 0;
        return s + h.monthlyAmount * ratio;
      }, 0),
    ),
  }));
  const grossTotal = perHead.reduce((s, h) => s + h.amount, 0);

  const paidTotal = receipts.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  const advanceBalance = Math.max(0, paidTotal - totalAllocated(paidForMonth, monthlyTotal));

  const concessionAmount = await computeConcessionAmount(schoolId, studentId, feeHeadDefs);
  const { amount: fineAmount, ids: fineIds } = await computePendingFines(schoolId, studentId);
  const { total: previousDues, months: previousDuesMonths } = computeOverdueArrears(session, monthlyTotal, paidForMonth, new Set(months));

  // Each selected/arrears month's own raw due — collect() allocates the receipt's
  // final (post-concession/advance/fine/waive-off) amount, PLUS whatever advance
  // credit it consumes, across these proportionally (see allocateAcrossMonths's
  // caller in collect() — the pool handed to it is netPayable + advance consumed,
  // not just netPayable, or the advance would reduce what's billed without ever
  // actually settling the months it was credited against).
  const rawDueByMonth = new Map<string, number>();
  for (const m of [...months, ...previousDuesMonths]) rawDueByMonth.set(m, rawDue(m));

  return { perHead, grossTotal, advanceBalance, concessionAmount, fineAmount, fineIds, previousDues, previousDuesMonths, rawDueByMonth };
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
    const { feeHeadDefs: feeHeads } = await studentFeeContext(schoolId, session, cls, studentId);

    const receipts = await ReceiptModel.find({ schoolId, studentId, status: 'active' }).sort({ paymentDate: -1 }).lean();
    const paid = receipts.reduce((s, r) => s + (r.amount ?? 0), 0);

    const startYear = parseInt(session.split('-')[0]!, 10) || new Date().getFullYear();
    const monthlyTotal = feeHeads.reduce((s, h) => s + h.monthlyAmount, 0);
    const paidForMonth = buildPaidForMonth(receipts);
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
    const { total: previousDues, months: previousDuesMonths } = computeOverdueArrears(session, monthlyTotal, paidForMonth, new Set());

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
      // Must match `previousDues` below (same per-month arrears calc), not a
      // naive totalFee-minus-paid: a family can prepay several months heavily
      // while other already-due months sit unpaid, so comparing the ANNUAL
      // total against total cash received says "fully paid" while specific
      // due months are still outstanding — exactly what the collection screen
      // bills via `previousDues`. Showing a different number here than what
      // the collect screen then charges is the actual bug this fixes.
      outstandingBalance: previousDues,
      advanceBalance: Math.max(0, paid - totalAllocated(paidForMonth, monthlyTotal)),
      lastPayment: receipts[0]
        ? { date: receipts[0].paymentDate ?? '', amount: receipts[0].amount ?? 0, receiptNumber: receipts[0].receiptNumber }
        : undefined,
      siblings,
      months,
      feeHeads,
      concessionAmount,
      fineAmount,
      previousDues,
      // Which months make up `previousDues` — the collection page must drop any
      // month from this list that the staff member also ticks in the month
      // picker, or it double-counts that month's due (once as part of the
      // selected months' gross total, again inside this flat previousDues figure).
      previousDuesMonths,
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

    const months = Array.isArray(p.months) ? [...new Set(p.months)].filter((m) => (SESSION_MONTHS as readonly string[]).includes(m)) : [];
    const { perHead, grossTotal, advanceBalance, concessionAmount, fineAmount, fineIds, rawDueByMonth } =
      await recomputeCollectionTotals(schoolId, student, months);

    // A collection only settles the months the staff member actually ticked —
    // `previousDues` (other overdue months) is informational only, shown so
    // staff can see the student is in arrears, but is NOT auto-folded into
    // this transaction. Ticking just one month must collect (and mark paid)
    // only that month, leaving the rest pending, so genuine partial/
    // month-by-month collection works. (Previously every overdue month was
    // forced into every receipt regardless of selection, making the month
    // picker charge the same full-arrears total no matter what was checked.)
    const monthsCovered = [...new Set(months)];

    // Concession is a monthly entitlement — scale it by how many months this
    // receipt actually settles, so paying N months in one visit gives the same
    // total concession as paying them one at a time (previously it was a flat
    // one-time deduction regardless of months.length, under-crediting any
    // multi-month collection; studentLedger has always annualized it ×12,
    // which only makes sense if this side treats it as per-month too).
    const scaledConcessionAmount = concessionAmount * Math.max(1, monthsCovered.length);

    // Matches PaymentSummaryBlock's net formula on the frontend exactly:
    // gross − concession − advance + fine, then waive-off. `previousDues` is
    // display-only (see above) and intentionally excluded here.
    const duesBeforeAdvance = Math.max(0, grossTotal - scaledConcessionAmount + fineAmount);
    const preWaive = duesBeforeAdvance - advanceBalance;
    const waiveOffAmount = Math.min(Math.max(0, Number(p.waiveOffAmount) || 0), Math.max(0, preWaive));
    const netPayable = Math.max(0, Math.round(preWaive - waiveOffAmount));
    // How much of the existing advance credit this collection actually uses —
    // never more than what's owed (any excess stays as advance for next time).
    const advanceConsumed = Math.min(Math.max(0, advanceBalance), duesBeforeAdvance);

    const clientNetPayable = Number(p.netPayable);
    if (!Number.isFinite(clientNetPayable) || Math.abs(netPayable - clientNetPayable) > 1) {
      throw ApiError.badRequest(
        `Recalculated total (₹${netPayable}) does not match the submitted amount (₹${Number.isFinite(clientNetPayable) ? clientNetPayable : p.netPayable}). Refresh the student and try again.`,
      );
    }

    const receiptNumber = await nextReceiptNumber(schoolId);
    // Split (real cash collected + advance credit consumed) across monthsCovered
    // proportionally to each month's own raw due — see buildPaidForMonth. Using
    // netPayable alone here was the bug: advance was already subtracted out of
    // netPayable (so the parent legitimately owed less), but the months it paid
    // for never got the credit recorded against them, so they stayed "partial"
    // forever and the same advance kept reappearing on every later collection
    // instead of ever being spent down.
    const monthAllocations = allocateAcrossMonths(monthsCovered, rawDueByMonth, netPayable + advanceConsumed);
    const doc = await ReceiptModel.create({
      schoolId,
      receiptNumber,
      studentId: p.studentId,
      studentName: student.name ?? '—',
      className: student.className ?? '—',
      section: student.section ?? '—',
      monthsCovered,
      monthAllocations,
      feeHeads: perHead.map((h) => ({ name: h.name, amount: h.amount })),
      amount: netPayable,
      paymentMode: p.payments[0]?.mode ?? 'cash',
      payments: p.payments,
      waiveOff: waiveOffAmount > 0 ? { amount: waiveOffAmount, reason: p.waiveOffReason ?? '—' } : undefined,
      paymentDate: p.paymentDate,
      generatedBy,
      status: 'active',
      fineIds,
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
    if (original.status !== 'active' || original.reversedAt) {
      throw ApiError.badRequest('Only an active, unreversed receipt can be duplicated');
    }
    original.status = 'duplicate_issued';
    await original.save();
    const dup = await ReceiptModel.create({
      ...original.toObject(),
      _id: undefined,
      receiptNumber: `${original.receiptNumber}-DUP`,
      status: 'active',
      reversedAt: undefined,
    });
    if (dup.schoolId && dup.studentId) await syncStudentFeeStatus(String(dup.schoolId), String(dup.studentId));
    return toReceipt(dup.toObject());
  },

  async cancelReceipt(schoolId: string | undefined, id: string, reason: string, by: string) {
    const doc = await ReceiptModel.findOneAndUpdate(
      { ...(schoolId ? { _id: id, schoolId } : { _id: id }), status: 'active', reversedAt: { $exists: false } },
      { status: 'cancelled', cancelledReason: reason, cancelledBy: by, cancelledAt: new Date().toISOString() },
      { new: true },
    );
    if (!doc) throw ApiError.badRequest('Only an active, unreversed receipt can be cancelled');
    await restoreFines(doc.schoolId ? String(doc.schoolId) : schoolId, doc.fineIds as unknown[] | undefined);
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

  /** Reversal = a new offsetting negative-amount receipt; original stays `status:'active'` (so +X and -X cancel exactly to 0 in every sum) but gets `reversedAt` set, which blocks a second cancel/duplicate/reverse. */
  async reverseReceipt(schoolId: string | undefined, id: string, reason: string, by: string) {
    const original = await ReceiptModel.findOne(schoolId ? { _id: id, schoolId } : { _id: id });
    if (!original) throw ApiError.notFound('Receipt not found');
    if (original.status !== 'active' || original.reversedAt) {
      throw ApiError.badRequest('Only an active, unreversed receipt can be reversed');
    }
    const reversalNumber = `${original.receiptNumber}-REV`;
    // The (schoolId, receiptNumber) index is unique, so a second reversal
    // would surface as a raw 11000 CONFLICT. Detect it here too.
    const alreadyReversed = await ReceiptModel.findOne(
      original.schoolId ? { schoolId: original.schoolId, receiptNumber: reversalNumber } : { receiptNumber: reversalNumber },
    ).lean();
    if (alreadyReversed) {
      original.reversedAt = new Date().toISOString();
      await original.save();
      throw ApiError.badRequest('This receipt has already been reversed');
    }
    const reversal = await ReceiptModel.create({
      ...original.toObject(),
      _id: undefined,
      receiptNumber: reversalNumber,
      amount: -Number(original.amount ?? 0),
      status: 'active',
      reversedAt: undefined,
      generatedBy: by,
      remarks: reason,
      payments: [],
      waiveOff: undefined,
      fineIds: [],
      // Mirror the original's per-month split, negated — so this reversal cancels
      // out exactly in buildPaidForMonth for each of those months too, not just in
      // the receipt-level amount sum.
      monthAllocations: ((original.monthAllocations as Array<{ month?: string; amount?: number }> | undefined) ?? []).map((a) => ({
        month: a.month,
        amount: -(Number(a.amount) || 0),
      })),
    });
    // Original keeps status:'active' (still +X in every sum) but is locked via reversedAt.
    original.reversedAt = new Date().toISOString();
    await original.save();
    await restoreFines(original.schoolId ? String(original.schoolId) : schoolId, original.fineIds as unknown[] | undefined);
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

  /** School-wide outstanding balance: sum of (class annual fee + route transport fee - paid) across students with dues. */
  async getTotalOutstanding(schoolId: string): Promise<{ amount: number; studentsCount: number }> {
    const session = await getActiveSessionName(schoolId);
    const [annual, transportByStudent, students, receipts] = await Promise.all([
      annualByClass(schoolId, session),
      transportFeeByStudent(schoolId),
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
      const totalFee = (annual[s.className ?? ''] ?? 0) + (transportByStudent.get(String(s._id)) ?? 0) * 12;
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
    const [annual, transportByStudent] = await Promise.all([annualByClass(schoolId, session), transportFeeByStudent(schoolId)]);
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
      const totalFee = (annual[className] ?? 0) + (transportByStudent.get(String(s._id)) ?? 0) * 12;
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
    const { feeHeadDefs, totalFee } = await studentFeeContext(schoolId, session, cls, studentId);
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
    const paidForMonth = buildPaidForMonth(receipts);

    // One row per session month — matches how student-fee-ledger-tab.tsx
    // renders it (`key={row.month}`), not one row per past receipt (a
    // receipt's own "balance" is trivially 0 by construction, which is what
    // the old per-receipt rows always showed).
    const rows = SESSION_MONTHS.map((month) => {
      const covering = receipts.filter((r) => ((r.monthsCovered as string[] | undefined) ?? []).includes(month));
      const monthPaid = paidForMonth(month);
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
    const filter: Record<string, unknown> = { schoolId };
    if (query.className && query.className !== 'all') filter.className = query.className;
    if (query.section && query.section !== 'all') filter.section = query.section;
    const students = await StudentModel.find(filter).lean();
    const studentIds = students.map((s) => String(s._id));
    const [annual, transportByStudent, transportName] = await Promise.all([
      annualByClass(schoolId, session),
      transportFeeByStudent(schoolId, studentIds),
      transportHeadName(schoolId),
    ]);

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
    const classDefsFor = async (className: string): Promise<FeeHeadDef[]> => {
      const cached = feeHeadDefsByClass.get(className);
      if (cached) return cached;
      const defs = await feeHeadDefsForClass(schoolId, session, className);
      feeHeadDefsByClass.set(className, defs);
      return defs;
    };
    /** Class-wide defs plus this student's own route transport line, if assigned. */
    const feeHeadDefsFor = async (sid: string, className: string): Promise<FeeHeadDef[]> => {
      const classDefs = await classDefsFor(className);
      const transportFee = transportByStudent.get(sid) ?? 0;
      return transportFee > 0 ? [...classDefs, { id: 'transport', name: transportName, monthlyAmount: transportFee }] : classDefs;
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
        const annualFee = (annual[s.className ?? ''] ?? 0) + (transportByStudent.get(sid) ?? 0) * 12;
        const feeHeadDefs = await feeHeadDefsFor(sid, s.className ?? '');
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
          paid = buildPaidForMonth(studentReceipts)(monthFull);
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
