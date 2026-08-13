import { Schema, model, type InferSchemaType } from 'mongoose';

const denominationLineSchema = new Schema(
  { value: Number, kind: String, count: Number },
  { _id: false },
);

const chequeToDepositSchema = new Schema(
  { receiptNumber: String, amount: Number, bankName: String },
  { _id: false },
);

const scrollModeTotalSchema = new Schema(
  { mode: String, total: Number, count: Number },
  { _id: false },
);

const dayCloseRecordSchema = new Schema(
  {
    openingBalance: Number,
    cashCollected: Number,
    cashExpenses: Number,
    expectedCash: Number,
    countedCash: Number,
    variance: Number,
    varianceReason: String,
    denominations: { type: [denominationLineSchema], default: [] },
    modeTotals: { type: [scrollModeTotalSchema], default: [] },
    deposit: {
      type: new Schema({ amount: Number, bankName: String, slipNo: String }, { _id: false }),
      default: undefined,
    },
    handover: {
      type: new Schema({ to: String, amount: Number }, { _id: false }),
      default: undefined,
    },
    retained: Number,
    chequesToDeposit: { type: [chequeToDepositSchema], default: [] },
  },
  { _id: false },
);

const daySessionSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    date: { type: String, required: true },
    collector: { type: String, default: '' },
    collectorId: { type: String, required: true },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    openingBalance: { type: Number, default: 0 },
    openingReason: String,
    openedBy: String,
    openedAt: String,
    closedBy: String,
    closedAt: String,
    closing: { type: dayCloseRecordSchema, default: undefined },
    reopenedBy: String,
    reopenReason: String,
    reopenedAt: String,
  },
  { timestamps: true },
);
daySessionSchema.index({ schoolId: 1, collectorId: 1, date: 1 }, { unique: true });
daySessionSchema.index({ schoolId: 1, date: 1 });
export type DaySessionDoc = InferSchemaType<typeof daySessionSchema>;
export const DaySessionModel = model('DaySession', daySessionSchema);

const scrollExpenseSchema = new Schema({
  schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
  date: { type: String, required: true },
  collector: { type: String, default: '' },
  collectorId: { type: String, required: true },
  category: { type: String, default: '' },
  description: { type: String, default: '' },
  amount: { type: Number, default: 0 },
  mode: { type: String, default: 'cash' },
  voucherNo: { type: String, default: '' },
  createdAt: { type: String, default: '' },
});
scrollExpenseSchema.index({ schoolId: 1, date: 1 });
export type ScrollExpenseDoc = InferSchemaType<typeof scrollExpenseSchema>;
export const ScrollExpenseModel = model('ScrollExpense', scrollExpenseSchema);
