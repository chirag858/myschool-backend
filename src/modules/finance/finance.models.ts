import { Schema, model, type InferSchemaType } from 'mongoose';

// No Mongoose timestamps here — these entities carry their own `createdAt` string.
const bankAccountSchema = new Schema({
  schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
  bankName: { type: String, required: true },
  accountLabel: { type: String, default: '' },
  accountLast4: { type: String, default: '' },
  branch: String,
});
export type BankAccountDoc = InferSchemaType<typeof bankAccountSchema>;
export const BankAccountModel = model('BankAccount', bankAccountSchema);

const bankDepositSchema = new Schema({
  schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
  depositDate: { type: String, required: true },
  depositTime: String,
  recipientType: { type: String, default: 'bank' },
  bankAccountId: String,
  bankName: String,
  accountLabel: String,
  amount: { type: Number, default: 0 },
  slipNumber: String,
  remarks: String,
  depositedBy: { type: String, default: 'System' },
  createdAt: { type: String, default: '' },
});
export type BankDepositDoc = InferSchemaType<typeof bankDepositSchema>;
export const BankDepositModel = model('BankDeposit', bankDepositSchema);

const incomeSchema = new Schema({
  schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
  date: { type: String, default: '' },
  source: { type: String, default: 'other' },
  description: { type: String, default: '' },
  amount: { type: Number, default: 0 },
  mode: { type: String, default: 'cash' },
  reference: String,
  createdBy: { type: String, default: 'System' },
  createdAt: { type: String, default: '' },
});
export type IncomeDoc = InferSchemaType<typeof incomeSchema>;
export const IncomeModel = model('Income', incomeSchema);

const vendorPaymentSchema = new Schema({
  schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
  date: { type: String, default: '' },
  vendorId: String,
  vendorName: { type: String, default: '' },
  amount: { type: Number, default: 0 },
  mode: { type: String, default: 'cash' },
  reference: { type: String, default: '' },
  billRef: String,
  note: String,
  createdBy: { type: String, default: 'System' },
  createdAt: { type: String, default: '' },
});
export type VendorPaymentDoc = InferSchemaType<typeof vendorPaymentSchema>;
export const VendorPaymentModel = model('VendorPayment', vendorPaymentSchema);
