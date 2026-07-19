import { ApiError } from '../../lib/api-error';
import {
  AssetModel,
  InventoryItemModel,
  PurchaseModel,
  StockIssueModel,
  StockMovementModel,
  VendorModel,
} from './inventory.models';

type Doc = Record<string, unknown> & { _id: unknown };
const today = (): string => new Date().toISOString().slice(0, 10);
const isId = (v: unknown): boolean => /^[0-9a-fA-F]{24}$/.test(String(v ?? ''));

function dto(d: Doc): Record<string, unknown> {
  const { _id, __v, schoolId, createdAt, updatedAt, ...rest } = d as Record<string, unknown>;
  void __v;
  void schoolId;
  void createdAt;
  void updatedAt;
  return { id: String(_id), ...rest };
}

function itemStatus(stock: number, min: number): string {
  if (stock <= 0) return 'out_of_stock';
  if (stock <= min) return 'low_stock';
  return 'in_stock';
}

interface Line {
  itemId: string;
  itemName?: string;
  quantity: number;
  unitPrice?: number;
}

export const inventoryService = {
  async kpi(schoolId: string) {
    const [items, assets] = await Promise.all([
      InventoryItemModel.find({ schoolId }).lean(),
      AssetModel.find({ schoolId }).lean(),
    ]);
    const categories = new Set(items.map((i) => i.category).filter(Boolean));
    return {
      totalCategories: categories.size,
      totalItems: items.length,
      lowStockAlerts: items.filter((i) => (i.currentStock ?? 0) <= (i.minStockLevel ?? 0)).length,
      totalAssetsValue: assets.reduce((s, a) => s + (a.currentValue ?? 0), 0),
    };
  },

  // Items
  async getItems(schoolId: string, q: Record<string, string>) {
    const filter: Record<string, unknown> = { schoolId };
    if (q.category && q.category !== 'all') filter.category = q.category;
    if (q.status && q.status !== 'all') filter.status = q.status;
    if (q.search?.trim()) filter.name = new RegExp(q.search.trim(), 'i');
    const docs = await InventoryItemModel.find(filter).sort({ name: 1 }).lean();
    return docs.map(dto);
  },
  async getItem(schoolId: string, id: string) {
    const d = await InventoryItemModel.findOne({ _id: id, schoolId }).lean();
    if (!d) throw ApiError.notFound('Item not found');
    return dto(d);
  },
  async upsertItem(schoolId: string, item: Record<string, unknown>) {
    const stock = Number(item.currentStock) || 0;
    const min = Number(item.minStockLevel) || 0;
    const { id, ...rest } = item;
    const fields = { ...rest, status: itemStatus(stock, min) };
    if (isId(id)) {
      const existing = await InventoryItemModel.findOne({ _id: id, schoolId });
      if (existing) {
        existing.set(fields);
        await existing.save();
        return dto(existing.toObject());
      }
    }
    const doc = await InventoryItemModel.create({ schoolId, ...fields });
    return dto(doc.toObject());
  },
  async getMovements(schoolId: string, itemId: string) {
    const docs = await StockMovementModel.find({ schoolId, itemId }).sort({ createdAt: -1 }).lean();
    return docs.map(dto);
  },

  // Purchase
  async getPurchases(schoolId: string) {
    const docs = await PurchaseModel.find({ schoolId }).sort({ createdAt: -1 }).lean();
    return docs.map(dto);
  },
  async addPurchase(schoolId: string, entry: Record<string, unknown>, addedBy: string) {
    const purchase = await PurchaseModel.create({ schoolId, ...entry, addedBy });
    const lines = (entry.items as Line[]) ?? [];
    const stockUpdates = [];
    for (const line of lines) {
      const item = await InventoryItemModel.findOne({ _id: line.itemId, schoolId });
      const added = Number(line.quantity) || 0;
      const newTotal = (item?.currentStock ?? 0) + added;
      if (item) {
        item.currentStock = newTotal;
        item.status = itemStatus(newTotal, item.minStockLevel ?? 0);
        await item.save();
        await StockMovementModel.create({
          schoolId,
          itemId: String(item._id),
          date: today(),
          type: 'purchase',
          quantity: added,
          balanceAfter: newTotal,
          reference: entry.invoiceNumber as string,
          performedBy: addedBy,
        });
      }
      stockUpdates.push({ itemId: line.itemId, itemName: line.itemName ?? item?.name ?? '', added, newTotal });
    }
    return { entry: dto(purchase.toObject()), stockUpdates };
  },

  // Issue
  async getIssues(schoolId: string) {
    const docs = await StockIssueModel.find({ schoolId }).sort({ createdAt: -1 }).lean();
    return docs.map(dto);
  },
  async addIssue(schoolId: string, entry: Record<string, unknown>) {
    const lines = (entry.items as Line[]) ?? [];
    const doc = await StockIssueModel.create({ schoolId, ...entry, itemsCount: lines.length });
    for (const line of lines) {
      const item = await InventoryItemModel.findOne({ _id: line.itemId, schoolId });
      if (item) {
        const next = Math.max(0, (item.currentStock ?? 0) - (Number(line.quantity) || 0));
        item.currentStock = next;
        item.status = itemStatus(next, item.minStockLevel ?? 0);
        await item.save();
        await StockMovementModel.create({
          schoolId,
          itemId: String(item._id),
          date: today(),
          type: 'issue',
          quantity: Number(line.quantity) || 0,
          balanceAfter: next,
          reference: String(doc._id),
          performedBy: entry.issuedTo as string,
        });
      }
    }
    return dto(doc.toObject());
  },

  // Vendors
  async getVendors(schoolId: string) {
    const docs = await VendorModel.find({ schoolId }).sort({ name: 1 }).lean();
    return docs.map(dto);
  },
  async upsertVendor(schoolId: string, v: Record<string, unknown>) {
    const { id, ...fields } = v;
    if (isId(id)) {
      const existing = await VendorModel.findOne({ _id: id, schoolId });
      if (existing) {
        existing.set(fields);
        await existing.save();
        return dto(existing.toObject());
      }
    }
    const doc = await VendorModel.create({ schoolId, ...fields });
    return dto(doc.toObject());
  },

  // Assets
  async getAssets(schoolId: string) {
    const docs = await AssetModel.find({ schoolId }).sort({ name: 1 }).lean();
    return docs.map(dto);
  },
  async upsertAsset(schoolId: string, a: Record<string, unknown>) {
    const { id, ...fields } = a;
    if (isId(id)) {
      const existing = await AssetModel.findOne({ _id: id, schoolId });
      if (existing) {
        existing.set(fields);
        await existing.save();
        return dto(existing.toObject());
      }
    }
    const doc = await AssetModel.create({ schoolId, ...fields });
    return dto(doc.toObject());
  },
};
