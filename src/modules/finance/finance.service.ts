import { Types } from 'mongoose';

import { ApiError } from '../../lib/api-error';
import { ScrollExpenseModel } from '../fee/fee-scroll.models';
import { ReceiptModel } from '../fee/fee.models';
import {
  BankAccountModel,
  BankDepositModel,
  IncomeModel,
  VendorPaymentModel,
} from './finance.models';

type Doc = Record<string, unknown> & { _id: unknown };
const nowIso = (): string => new Date().toISOString();
const today = (): string => nowIso().slice(0, 10);

/** Strip mongo internals; keep the entity's own `createdAt` (no timestamps here). */
function dto(d: Doc): Record<string, unknown> {
  const { _id, __v, schoolId, ...rest } = d as Record<string, unknown>;
  void __v;
  void schoolId;
  return { id: String(_id), ...rest };
}

export const financeService = {
  // ── Bank deposits ──
  async getBankAccounts(schoolId: string) {
    return (await BankAccountModel.find({ schoolId }).sort({ bankName: 1 }).lean()).map(dto);
  },
  async getDeposits(schoolId: string) {
    return (await BankDepositModel.find({ schoolId }).sort({ depositDate: -1, createdAt: -1 }).lean()).map(dto);
  },
  async recordDeposit(schoolId: string, payload: Record<string, unknown>, depositedBy: string) {
    let bankName: string | undefined;
    let accountLabel: string | undefined;
    let bankAccountId: string | undefined;
    if (payload.recipientType === 'bank') {
      const account = await BankAccountModel.findOne({ _id: payload.bankAccountId, schoolId }).lean();
      if (!account) throw ApiError.badRequest('Unknown bank account');
      bankName = account.bankName;
      accountLabel = account.accountLabel;
      bankAccountId = String(account._id);
    }
    const doc = await BankDepositModel.create({
      schoolId,
      depositDate: payload.depositDate,
      depositTime: payload.depositTime,
      recipientType: payload.recipientType,
      bankAccountId,
      bankName,
      accountLabel,
      amount: payload.amount,
      slipNumber: payload.slipNumber,
      remarks: payload.remarks,
      depositedBy,
      createdAt: nowIso(),
    });
    return dto(doc.toObject());
  },
  async depositStats(schoolId: string) {
    const deposits = await BankDepositModel.find({ schoolId }).lean();
    const month = today().slice(0, 7);
    return {
      monthTotal: deposits.filter((d) => (d.depositDate ?? '').startsWith(month)).reduce((s, d) => s + (d.amount ?? 0), 0),
      allTimeTotal: deposits.reduce((s, d) => s + (d.amount ?? 0), 0),
      count: deposits.length,
    };
  },

  // ── Income ──
  async getIncome(schoolId: string) {
    return (await IncomeModel.find({ schoolId }).sort({ createdAt: -1 }).lean()).map(dto);
  },
  async addIncome(schoolId: string, payload: Record<string, unknown>, createdBy: string) {
    const doc = await IncomeModel.create({ schoolId, ...payload, date: today(), createdBy, createdAt: nowIso() });
    return dto(doc.toObject());
  },

  // ── Vendor payments ──
  async getVendorPayments(schoolId: string) {
    return (await VendorPaymentModel.find({ schoolId }).sort({ createdAt: -1 }).lean()).map(dto);
  },
  async recordVendorPayment(schoolId: string, payload: Record<string, unknown>, createdBy: string) {
    const doc = await VendorPaymentModel.create({ schoolId, ...payload, date: today(), createdBy, createdAt: nowIso() });
    return dto(doc.toObject());
  },

  // ── Cash book (merged income + expense + vendor payments, chronological — computed server-side) ──
  async getCashBook(schoolId: string) {
    const [income, expenses, vendorPayments] = await Promise.all([
      IncomeModel.find({ schoolId }).lean(),
      ScrollExpenseModel.find({ schoolId }).lean(),
      VendorPaymentModel.find({ schoolId }).lean(),
    ]);
    const rows = [
      ...income.map((i) => ({
        id: String(i._id),
        date: i.date,
        type: 'income' as const,
        particulars: i.description,
        mode: i.mode,
        amountIn: i.amount ?? 0,
        amountOut: 0,
      })),
      ...expenses.map((e) => ({
        id: String(e._id),
        date: e.date,
        type: 'expense' as const,
        particulars: e.description,
        mode: e.mode,
        amountIn: 0,
        amountOut: e.amount ?? 0,
      })),
      ...vendorPayments.map((v) => ({
        id: String(v._id),
        date: v.date,
        type: 'vendor_payment' as const,
        particulars: `${v.vendorName}${v.note ? ` — ${v.note}` : ''}`,
        mode: v.mode,
        amountIn: 0,
        amountOut: v.amount ?? 0,
      })),
    ];
    return rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  },

  // ── Profit & Loss (session-wide — computed server-side, no full-table client fetch) ──
  async getProfitLoss(schoolId: string) {
    const sid = new Types.ObjectId(schoolId);
    const [feeIncomeAgg, otherIncomeAgg, expenseAgg, vendorPaymentAgg] = await Promise.all([
      ReceiptModel.aggregate([
        { $match: { schoolId: sid, status: 'active' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      IncomeModel.aggregate([{ $match: { schoolId: sid } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      ScrollExpenseModel.aggregate([{ $match: { schoolId: sid } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      VendorPaymentModel.aggregate([{ $match: { schoolId: sid } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    ]);
    const feeIncome = feeIncomeAgg[0]?.total ?? 0;
    const otherIncome = otherIncomeAgg[0]?.total ?? 0;
    const totalIncome = feeIncome + otherIncome;
    const totalExpense = (expenseAgg[0]?.total ?? 0) + (vendorPaymentAgg[0]?.total ?? 0);
    return { feeIncome, otherIncome, totalIncome, totalExpense, net: totalIncome - totalExpense };
  },

  // ── Dashboard stats (this calendar month — computed server-side) ──
  async getExpenseStats(schoolId: string) {
    const monthPrefix = today().slice(0, 7);
    const monthMatch = { schoolId: new Types.ObjectId(schoolId), createdAt: { $regex: `^${monthPrefix}` } };
    const [monthIncomeAgg, monthExpenseAgg, monthVendorAgg] = await Promise.all([
      IncomeModel.aggregate([{ $match: monthMatch }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      ScrollExpenseModel.aggregate([{ $match: monthMatch }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      VendorPaymentModel.aggregate([{ $match: monthMatch }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    ]);
    const monthIncome = monthIncomeAgg[0]?.total ?? 0;
    const monthExpense = (monthExpenseAgg[0]?.total ?? 0) + (monthVendorAgg[0]?.total ?? 0);
    return {
      monthIncome,
      monthExpense,
      netMonth: monthIncome - monthExpense,
      // No invoice/dues model exists yet (Vendor/PurchaseEntry track spend, not outstanding
      // balances) — vendorDue can't be computed for real until that data exists.
      vendorDue: 0,
    };
  },
};
