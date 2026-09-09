import { UserModel } from '../user/user.model';
import { ReceiptModel, type ReceiptDoc } from './fee.models';
import { DaySessionModel, ScrollExpenseModel, type ScrollExpenseDoc } from './fee-scroll.models';

const PAYMENT_MODES = ['cash', 'upi', 'online', 'bank', 'cheque', 'card', 'dd'] as const;
type PaymentMode = (typeof PAYMENT_MODES)[number];

interface ScrollEntry {
  id: string;
  time: string;
  type: 'collection' | 'expense';
  reference: string;
  particulars: string;
  mode: PaymentMode;
  transactionRef: string;
  amountIn: number;
  amountOut: number;
  cancelled: boolean;
  linkKind: 'receipt' | 'expense';
  linkId: string;
}

type Doc = Record<string, unknown> & { _id: unknown };
function dto(d: Doc): Record<string, unknown> {
  const { _id, __v, schoolId, ...rest } = d as Record<string, unknown>;
  void __v;
  void schoolId;
  return { id: String(_id), ...rest };
}

function nowIso(): string {
  return new Date().toISOString();
}

function txnRef(payment: Record<string, unknown>): string {
  return String(payment.chequeNumber ?? payment.ddNumber ?? payment.transactionNumber ?? '');
}

async function receiptsForDate(schoolId: string, date: string): Promise<ReceiptDoc[]> {
  return ReceiptModel.find({ schoolId, paymentDate: { $regex: `^${date}` } }).lean();
}

function collectionEntries(
  receipts: readonly Record<string, unknown>[],
  match: (r: Record<string, unknown>) => boolean,
): ScrollEntry[] {
  const entries: ScrollEntry[] = [];
  for (const r of receipts) {
    if (!match(r)) continue;
    const id = String(r._id);
    const receiptNumber = String(r.receiptNumber ?? '');
    const particulars = `${r.studentName} · ${r.className}-${r.section}`;
    const time = String(r.createdAt ?? r.paymentDate ?? '');
    if (r.status === 'cancelled') {
      entries.push({
        id: `${id}_x`,
        time,
        type: 'collection',
        reference: receiptNumber,
        particulars,
        mode: (r.paymentMode as PaymentMode) ?? 'cash',
        transactionRef: '',
        amountIn: Number(r.amount ?? 0),
        amountOut: 0,
        cancelled: true,
        linkKind: 'receipt',
        linkId: id,
      });
      continue;
    }
    const payments = Array.isArray(r.payments) && r.payments.length > 0
      ? (r.payments as Record<string, unknown>[])
      : [{ mode: r.paymentMode, amount: r.amount }];
    payments.forEach((p, i) => {
      entries.push({
        id: `${id}_${i}`,
        time,
        type: 'collection',
        reference: receiptNumber,
        particulars,
        mode: (p.mode as PaymentMode) ?? 'cash',
        transactionRef: 'chequeNumber' in p || 'ddNumber' in p || 'transactionNumber' in p ? txnRef(p) : '',
        amountIn: Number(p.amount ?? 0),
        amountOut: 0,
        cancelled: false,
        linkKind: 'receipt',
        linkId: id,
      });
    });
  }
  return entries;
}

function expenseEntries(
  expenses: readonly ScrollExpenseDoc[],
  match: (e: ScrollExpenseDoc) => boolean,
): ScrollEntry[] {
  return expenses.filter(match).map((e) => ({
    id: String((e as unknown as Doc)._id),
    time: e.createdAt ?? '',
    type: 'expense' as const,
    reference: e.voucherNo ?? '',
    particulars: e.description ?? '',
    mode: (e.mode as PaymentMode) ?? 'cash',
    transactionRef: '',
    amountIn: 0,
    amountOut: e.amount ?? 0,
    cancelled: false,
    linkKind: 'expense' as const,
    linkId: String((e as unknown as Doc)._id),
  }));
}

function buildModeTotals(entries: readonly ScrollEntry[]) {
  const byMode = new Map<PaymentMode, { total: number; count: number }>();
  for (const mode of PAYMENT_MODES) byMode.set(mode, { total: 0, count: 0 });
  for (const e of entries) {
    if (e.cancelled || e.type !== 'collection') continue;
    const bucket = byMode.get(e.mode);
    if (!bucket) continue;
    bucket.total += e.amountIn;
    bucket.count += 1;
  }
  return PAYMENT_MODES.map((mode) => ({
    mode,
    total: byMode.get(mode)?.total ?? 0,
    count: byMode.get(mode)?.count ?? 0,
  }));
}

function chequesFrom(entries: readonly ScrollEntry[]) {
  return entries
    .filter((e) => e.type === 'collection' && !e.cancelled && e.mode === 'cheque')
    .map((e) => ({ receiptNumber: e.reference, amount: e.amountIn, bankName: '—' }));
}

/** Chains a collector's opening balance forward from their last closed day's retained cash. */
async function openingBalanceFor(schoolId: string, collectorId: string, date: string): Promise<number> {
  const exact = await DaySessionModel.findOne({ schoolId, collectorId, date }).lean();
  if (exact) return exact.openingBalance ?? 0;
  const prior = await DaySessionModel.findOne({ schoolId, collectorId, date: { $lt: date }, status: 'closed' })
    .sort({ date: -1 })
    .lean();
  return prior?.closing?.retained ?? 0;
}

export interface ScrollQuery {
  date: string;
  collectorId: string;
  collector: string;
  consolidated?: boolean;
}

async function assembleScroll(schoolId: string, query: ScrollQuery) {
  const { date, collectorId, collector, consolidated = false } = query;

  const [receipts, expenses] = await Promise.all([
    receiptsForDate(schoolId, date),
    ScrollExpenseModel.find({ schoolId, date }).lean(),
  ]);

  const matchReceipt = (r: Record<string, unknown>): boolean => consolidated || r.generatedBy === collector;
  const matchExpense = (e: ScrollExpenseDoc): boolean => consolidated || e.collectorId === collectorId;

  const entries = [
    ...collectionEntries(receipts as unknown as Record<string, unknown>[], matchReceipt),
    ...expenseEntries(expenses, matchExpense),
  ].sort((a, b) => (a.time < b.time ? -1 : 1));

  const live = entries.filter((e) => !e.cancelled);
  const collections = live.filter((e) => e.type === 'collection');
  const expenseRows = live.filter((e) => e.type !== 'collection');

  let openingBalance: number;
  if (consolidated) {
    const collectorIds = [...new Set(receipts.map((r) => r.generatedBy).filter(Boolean))] as string[];
    const openings = await Promise.all(collectorIds.map((id) => openingBalanceFor(schoolId, id, date)));
    openingBalance = openings.reduce((s, o) => s + o, 0);
  } else {
    openingBalance = await openingBalanceFor(schoolId, collectorId, date);
  }

  const totalCollected = collections.reduce((s, e) => s + e.amountIn, 0);
  const totalExpenses = expenseRows.reduce((s, e) => s + e.amountOut, 0);
  const cashCollected = collections.filter((e) => e.mode === 'cash').reduce((s, e) => s + e.amountIn, 0);
  const cashExpenses = expenseRows.filter((e) => e.mode === 'cash').reduce((s, e) => s + e.amountOut, 0);
  const netCashInHand = openingBalance + cashCollected - cashExpenses;

  const session = consolidated ? null : await DaySessionModel.findOne({ schoolId, collectorId, date }).lean();

  return {
    date,
    collector,
    collectorId,
    consolidated,
    session: session ? dto(session as unknown as Doc) : null,
    status: consolidated ? 'open' : (session?.status ?? 'not_opened'),
    openingBalance,
    entries,
    modeTotals: buildModeTotals(entries),
    totalCollected,
    totalExpenses,
    cashCollected,
    cashExpenses,
    netCashInHand,
    expectedCash: netCashInHand,
    closingBalance: netCashInHand,
    grandTotal: totalCollected,
    chequesToDeposit: chequesFrom(entries),
  };
}

export const feeScrollService = {
  getScroll: (schoolId: string, query: ScrollQuery) => assembleScroll(schoolId, query),

  /** Users who can operate a collection scroll — the pool selectable in the collector filter. */
  async getCollectors(schoolId: string) {
    const users = await UserModel.find({ schoolId, role: 'accountant' }).select('name').lean();
    return users.map((u) => ({ id: String(u._id), name: String(u.name ?? '') }));
  },

  async openDay(
    schoolId: string,
    collectorId: string,
    collector: string,
    payload: { date: string; openingBalance: number; reason?: string },
  ) {
    const doc = await DaySessionModel.findOneAndUpdate(
      { schoolId, collectorId, date: payload.date },
      {
        $set: {
          collector,
          status: 'open',
          openingBalance: payload.openingBalance,
          openingReason: payload.reason,
          openedBy: collector,
          openedAt: nowIso(),
        },
      },
      { upsert: true, new: true },
    ).lean();
    return dto(doc as unknown as Doc);
  },

  async closeDay(schoolId: string, collectorId: string, collector: string, input: {
    date: string;
    denominations: unknown;
    countedCash: number;
    variance: number;
    varianceReason?: string;
    deposit?: { amount: number; bankName: string; slipNo: string };
    handover?: { to: string; amount: number };
    retained: number;
  }) {
    const session = await DaySessionModel.findOne({ schoolId, collectorId, date: input.date });
    if (!session) return null;
    const data = await assembleScroll(schoolId, { date: input.date, collectorId, collector });
    session.status = 'closed';
    session.closedBy = collector;
    session.closedAt = nowIso();
    session.closing = {
      openingBalance: data.openingBalance,
      cashCollected: data.cashCollected,
      cashExpenses: data.cashExpenses,
      expectedCash: data.expectedCash,
      countedCash: input.countedCash,
      // Never trust the client's variance — a collector could hide a cash
      // shortfall by posting variance: 0. Server always computes it from the
      // server-derived expectedCash against the counted cash the collector reports.
      variance: data.expectedCash - input.countedCash,
      varianceReason: input.varianceReason,
      denominations: input.denominations as never,
      modeTotals: data.modeTotals as never,
      deposit: input.deposit,
      handover: input.handover,
      retained: input.retained,
      chequesToDeposit: data.chequesToDeposit as never,
    };
    await session.save();
    return dto(session.toObject() as unknown as Doc);
  },

  async reopenDay(schoolId: string, payload: { collectorId: string; date: string; reason: string }, reopenedBy: string) {
    const session = await DaySessionModel.findOne({ schoolId, collectorId: payload.collectorId, date: payload.date });
    if (!session) return null;
    session.status = 'open';
    session.reopenedBy = reopenedBy;
    session.reopenReason = payload.reason;
    session.reopenedAt = nowIso();
    await session.save();
    return dto(session.toObject() as unknown as Doc);
  },

  async addExpense(
    schoolId: string,
    collectorId: string,
    collector: string,
    payload: { category: string; description: string; amount: number; mode: string },
  ) {
    const date = nowIso().slice(0, 10);
    const count = await ScrollExpenseModel.countDocuments({ schoolId });
    const doc = await ScrollExpenseModel.create({
      schoolId,
      date,
      collector,
      collectorId,
      category: payload.category,
      description: payload.description,
      amount: payload.amount,
      mode: payload.mode,
      voucherNo: `VCH-${(count + 1).toString().padStart(4, '0')}`,
      createdAt: nowIso(),
    });
    return dto(doc.toObject() as unknown as Doc);
  },

  async getAllExpenses(schoolId: string) {
    return (await ScrollExpenseModel.find({ schoolId }).sort({ createdAt: -1 }).lean()).map((d) => dto(d as unknown as Doc));
  },

  async getConsolidated(schoolId: string, date: string) {
    const receipts = await receiptsForDate(schoolId, date);
    const sessions = await DaySessionModel.find({ schoolId, date }).lean();
    const names = new Set<string>([
      ...sessions.map((s) => s.collector).filter(Boolean),
      ...receipts.map((r) => r.generatedBy).filter(Boolean),
    ] as string[]);

    const rows = await Promise.all(
      [...names].map(async (name) => {
        const seeded = sessions.find((s) => s.collector === name);
        const collectorId = seeded?.collectorId ?? name;
        const data = await assembleScroll(schoolId, { date, collectorId, collector: name });
        const modeTotals = {} as Record<PaymentMode, number>;
        for (const mode of PAYMENT_MODES) modeTotals[mode] = 0;
        for (const m of data.modeTotals) modeTotals[m.mode] = m.total;
        return {
          collectorId,
          collector: name,
          modeTotals,
          total: data.totalCollected,
          status: data.session?.status ?? 'not_opened',
          variance: (data.session as { closing?: { variance?: number } } | null)?.closing?.variance ?? null,
        };
      }),
    );
    return rows;
  },

  async getHistory(schoolId: string, query: { dateFrom?: string; dateTo?: string; collectorId?: string }) {
    const filter: Record<string, unknown> = { schoolId };
    if (query.collectorId && query.collectorId !== 'all') filter.collectorId = query.collectorId;
    if (query.dateFrom || query.dateTo) {
      filter.date = {
        ...(query.dateFrom ? { $gte: query.dateFrom } : {}),
        ...(query.dateTo ? { $lte: query.dateTo } : {}),
      };
    }
    const sessions = await DaySessionModel.find(filter).sort({ date: -1 }).lean();
    const rows = await Promise.all(
      sessions.map(async (s) => {
        const data = await assembleScroll(schoolId, { date: s.date, collectorId: s.collectorId, collector: s.collector ?? '' });
        return {
          date: s.date,
          collector: s.collector,
          collectorId: s.collectorId,
          opening: data.openingBalance,
          collected: data.totalCollected,
          expenses: data.totalExpenses,
          closing: s.closing?.retained ?? data.closingBalance,
          variance: s.closing?.variance ?? null,
          status: s.status,
          session: dto(s as unknown as Doc),
        };
      }),
    );
    return rows;
  },
};
