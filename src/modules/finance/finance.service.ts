import { ApiError } from '../../lib/api-error';
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
};
