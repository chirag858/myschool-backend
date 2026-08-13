import { Schema, model, type InferSchemaType } from 'mongoose';

export const ITEM_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'issued', 'returned', 'cancelled', 'forwarded'] as const;
export const MISMATCH_STATUSES = ['open', 'investigated', 'resolved'] as const;

const itemRequestSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    itemId: { type: String, required: true },
    itemName: { type: String, default: '' },
    category: { type: String, default: '' },
    quantity: { type: Number, default: 1 },
    availableStock: { type: Number, default: 0 },
    unitPrice: { type: Number, default: 0 },
    purpose: { type: String, default: '' },
    department: { type: String, default: '' },
    requestedBy: { type: String, default: '' },
    requestedById: { type: String, default: '' },
    requestedOn: { type: String, default: '' },
    neededBy: String,
    priority: { type: String, enum: ['normal', 'urgent'], default: 'normal' },
    status: { type: String, enum: ITEM_REQUEST_STATUSES, default: 'pending' },
    approvedBy: String,
    approvedOn: String,
    rejectionReason: String,
  },
  { timestamps: true },
);
export type ItemRequestDoc = InferSchemaType<typeof itemRequestSchema>;
export const ItemRequestModel = model('ItemRequest', itemRequestSchema);

const stockMismatchSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    countedAt: { type: String, required: true },
    itemId: { type: String, required: true },
    itemName: { type: String, default: '' },
    category: { type: String, default: '' },
    systemStock: { type: Number, default: 0 },
    physicalCount: { type: Number, default: 0 },
    difference: { type: Number, default: 0 },
    countedBy: { type: String, default: '' },
    status: { type: String, enum: MISMATCH_STATUSES, default: 'open' },
    remarks: String,
  },
  { timestamps: true },
);
export type StockMismatchDoc = InferSchemaType<typeof stockMismatchSchema>;
export const StockMismatchModel = model('StockMismatch', stockMismatchSchema);
