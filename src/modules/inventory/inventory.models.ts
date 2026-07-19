import { Schema, model, type InferSchemaType } from 'mongoose';

const itemSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    name: { type: String, required: true },
    category: { type: String, default: '' },
    unit: { type: String, default: 'piece' },
    currentStock: { type: Number, default: 0 },
    minStockLevel: { type: Number, default: 0 },
    maxStockLevel: { type: Number, default: 0 },
    unitPrice: { type: Number, default: 0 },
    supplier: String,
    location: { type: String, default: '' },
    description: String,
    status: { type: String, default: 'in_stock' },
  },
  { timestamps: true },
);
export type ItemDoc = InferSchemaType<typeof itemSchema>;
export const InventoryItemModel = model('InventoryItem', itemSchema);

const movementSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    itemId: { type: String, required: true, index: true },
    date: { type: String, default: '' },
    type: { type: String, default: 'adjust' },
    quantity: { type: Number, default: 0 },
    balanceAfter: { type: Number, default: 0 },
    reference: String,
    performedBy: { type: String, default: 'System' },
    remarks: String,
  },
  { timestamps: true },
);
export type MovementDoc = InferSchemaType<typeof movementSchema>;
export const StockMovementModel = model('StockMovement', movementSchema);

const purchaseSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    purchaseDate: { type: String, default: '' },
    vendorName: { type: String, default: '' },
    vendorId: String,
    invoiceNumber: { type: String, default: '' },
    invoiceDate: { type: String, default: '' },
    paymentMode: { type: String, default: 'cash' },
    paymentReference: String,
    taxPercent: { type: Number, default: 0 },
    subtotal: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    items: { type: [Schema.Types.Mixed], default: [] },
    addedBy: { type: String, default: 'System' },
  },
  { timestamps: true },
);
export type PurchaseDoc = InferSchemaType<typeof purchaseSchema>;
export const PurchaseModel = model('Purchase', purchaseSchema);

const issueSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    date: { type: String, default: '' },
    issuedTo: { type: String, default: '' },
    department: { type: String, default: '' },
    purpose: { type: String, default: '' },
    itemsCount: { type: Number, default: 0 },
    returnExpected: { type: Boolean, default: false },
    returnDate: String,
    status: { type: String, enum: ['open', 'returned', 'partial'], default: 'open' },
    items: { type: [Schema.Types.Mixed], default: [] },
  },
  { timestamps: true },
);
export type IssueDoc = InferSchemaType<typeof issueSchema>;
export const StockIssueModel = model('StockIssue', issueSchema);

const vendorSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    name: { type: String, required: true },
    contactPerson: { type: String, default: '' },
    mobile: { type: String, default: '' },
    email: String,
    gstNumber: String,
    address: String,
    totalOrders: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
    bankAccount: String,
    ifsc: String,
    notes: String,
  },
  { timestamps: true },
);
export type VendorDoc = InferSchemaType<typeof vendorSchema>;
export const VendorModel = model('InventoryVendor', vendorSchema);

const assetSchema = new Schema(
  {
    schoolId: { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true },
    name: { type: String, required: true },
    assetCode: { type: String, default: '' },
    category: { type: String, default: '' },
    purchaseDate: { type: String, default: '' },
    purchasePrice: { type: Number, default: 0 },
    currentValue: { type: Number, default: 0 },
    location: { type: String, default: '' },
    assignedTo: String,
    warrantyExpiry: String,
    condition: { type: String, default: 'good' },
    description: String,
    photoUrl: String,
    vendor: String,
  },
  { timestamps: true },
);
export type AssetDoc = InferSchemaType<typeof assetSchema>;
export const AssetModel = model('Asset', assetSchema);
