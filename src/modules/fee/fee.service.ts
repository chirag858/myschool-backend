import { Types } from 'mongoose';

import { SessionModel } from '../academics/academics.models';
import { ApiError } from '../../lib/api-error';
import { StudentModel } from '../students/student.model';
import {
  FREQUENCY_MULTIPLIER,
  FeeHeadModel,
  FeeStructureModel,
  ReceiptModel,
} from './fee.models';

type Doc = Record<string, unknown> & { _id: unknown };

async function activeSession(schoolId: string): Promise<string> {
  const s = await SessionModel.findOne({ schoolId, status: 'active' }).lean();
  return s?.name ?? '2025-26';
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

async function annualByClass(schoolId: string, session: string): Promise<Record<string, number>> {
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
    const session = await activeSession(schoolId);
    const rows = await FeeStructureModel.find({ schoolId, session }).lean();
    const classes = (await StudentModel.distinct('className', { schoolId })) as string[];
    return {
      rows: rows.map((r) => ({ feeHeadId: r.feeHeadId, frequency: r.frequency, amounts: r.amounts ?? {} })),
      classes: classes.sort(),
      session,
    };
  },
  async saveStructure(schoolId: string, rows: Array<{ feeHeadId: string; frequency: string; amounts: Record<string, number> }>) {
    const session = await activeSession(schoolId);
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
    const session = await activeSession(schoolId);
    const structure = await FeeStructureModel.find({ schoolId, session }).lean();
    const heads = await FeeHeadModel.find({ schoolId }).lean();
    const headMap = new Map(heads.map((h) => [String(h._id), h.name]));
    const cls = student.className ?? '';

    const feeHeads = structure
      .filter((r) => (r.amounts as Record<string, number>)?.[cls] != null)
      .map((r) => ({
        id: r.feeHeadId,
        name: headMap.get(r.feeHeadId) ?? r.feeHeadId,
        monthlyAmount: Number((r.amounts as Record<string, number>)[cls]) || 0,
      }));

    const annual = await annualByClass(schoolId, session);
    const totalFee = annual[cls] ?? 0;

    const receipts = await ReceiptModel.find({ schoolId, studentId, status: 'active' }).sort({ paymentDate: -1 }).lean();
    const paid = receipts.reduce((s, r) => s + (r.amount ?? 0), 0);

    const MONTHS = ['April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March'];
    const monthlyTotal = feeHeads.reduce((s, h) => s + h.monthlyAmount, 0);
    const months = MONTHS.map((m, i) => {
      const paidForMonth = receipts
        .filter((r) => (r.monthsCovered ?? []).includes(m))
        .reduce((s, r) => s + (r.amount ?? 0), 0);
      const status = paidForMonth <= 0 ? 'pending' : paidForMonth >= monthlyTotal ? 'paid' : 'partial';
      return { month: m, year: i < 9 ? 2025 : 2026, amount: monthlyTotal, paid: paidForMonth, status };
    });

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
      concessionAmount: 0,
      fineAmount: 0,
      previousDues: 0,
    };
  },

  // ── Collection ──
  async collect(schoolId: string, payload: Record<string, unknown>, generatedBy: string) {
    const p = payload as {
      studentId: string;
      months: string[];
      feeHeads: Array<{ id: string; amount: number }>;
      netPayable: number;
      payments: Array<{ mode: string }>;
      paymentDate: string;
      waiveOffAmount?: number;
      waiveOffReason?: string;
      remarks?: string;
    };
    const student = await StudentModel.findOne({ _id: p.studentId, schoolId }).lean();
    const heads = await FeeHeadModel.find({ schoolId }).lean();
    const headMap = new Map(heads.map((h) => [String(h._id), h.name]));
    const receiptNumber = await nextReceiptNumber(schoolId);

    const doc = await ReceiptModel.create({
      schoolId,
      receiptNumber,
      studentId: p.studentId,
      studentName: student?.name ?? '—',
      className: student?.className ?? '—',
      section: student?.section ?? '—',
      monthsCovered: p.months,
      feeHeads: p.feeHeads.map((h) => ({ name: headMap.get(h.id) ?? h.id, amount: h.amount })),
      amount: p.netPayable,
      paymentMode: p.payments[0]?.mode ?? 'cash',
      payments: p.payments,
      waiveOff:
        p.waiveOffAmount && p.waiveOffAmount > 0 ? { amount: p.waiveOffAmount, reason: p.waiveOffReason ?? '—' } : undefined,
      paymentDate: p.paymentDate,
      generatedBy,
      status: 'active',
      remarks: p.remarks,
    });
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
    return toReceipt(dup.toObject());
  },

  async cancelReceipt(schoolId: string | undefined, id: string, reason: string, by: string) {
    const doc = await ReceiptModel.findOneAndUpdate(
      schoolId ? { _id: id, schoolId } : { _id: id },
      { status: 'cancelled', cancelledReason: reason, cancelledBy: by, cancelledAt: new Date().toISOString() },
      { new: true },
    );
    if (!doc) throw ApiError.notFound('Receipt not found');
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

  // ── Ledger ──
  async ledger(schoolId: string, query: Record<string, string>) {
    const session = await activeSession(schoolId);
    const annual = await annualByClass(schoolId, session);
    const filter: Record<string, unknown> = { schoolId };
    if (query.className && query.className !== 'all') filter.className = query.className;
    if (query.section && query.section !== 'all') filter.section = query.section;
    const students = await StudentModel.find(filter).lean();

    const paidAgg = await ReceiptModel.aggregate<{ _id: unknown; paid: number; last: string }>([
      { $match: { schoolId: new Types.ObjectId(schoolId), status: 'active', studentId: { $in: students.map((s) => s._id) } } },
      { $group: { _id: '$studentId', paid: { $sum: '$amount' }, last: { $max: '$paymentDate' } } },
    ]);
    const paidMap = new Map(paidAgg.map((p) => [String(p._id), p]));

    let rows = students.map((s) => {
      const totalFee = annual[s.className ?? ''] ?? 0;
      const p = paidMap.get(String(s._id));
      const paid = p?.paid ?? 0;
      const balance = Math.max(0, totalFee - paid);
      const status = paid <= 0 ? 'pending' : balance <= 0 ? 'paid' : 'partial';
      return {
        studentId: String(s._id),
        admissionNumber: s.admissionNumber,
        studentName: s.name,
        className: s.className ?? '',
        section: s.section ?? '',
        photoUrl: s.photoUrl,
        totalFee,
        concession: 0,
        netFee: totalFee,
        paid,
        balance,
        fine: 0,
        waived: 0,
        status,
        lastPaymentDate: p?.last,
      };
    });
    if (query.status && query.status !== 'all') rows = rows.filter((r) => r.status === query.status);
    return rows;
  },
};
