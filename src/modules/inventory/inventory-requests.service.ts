import { ApiError } from '../../lib/api-error';
import { UserModel } from '../user/user.model';
import { InventoryItemModel, StockIssueModel } from './inventory.models';
import { ItemRequestModel, StockMismatchModel } from './inventory-requests.models';

const FORWARD_THRESHOLD_INR = 10_000;

type Doc = Record<string, unknown> & { _id: unknown };

function toRequest(d: Doc) {
  return {
    id: String(d._id),
    itemId: d.itemId,
    itemName: d.itemName,
    category: d.category,
    quantity: d.quantity ?? 0,
    availableStock: d.availableStock ?? 0,
    unitPrice: d.unitPrice ?? 0,
    purpose: d.purpose,
    department: d.department,
    requestedBy: d.requestedBy,
    requestedById: d.requestedById,
    requestedOn: d.requestedOn,
    neededBy: d.neededBy,
    priority: d.priority,
    status: d.status,
    approvedBy: d.approvedBy,
    approvedOn: d.approvedOn,
    rejectionReason: d.rejectionReason,
  };
}
function toMismatch(d: Doc) {
  return {
    id: String(d._id),
    countedAt: d.countedAt,
    itemId: d.itemId,
    itemName: d.itemName,
    category: d.category,
    systemStock: d.systemStock ?? 0,
    physicalCount: d.physicalCount ?? 0,
    difference: d.difference ?? 0,
    countedBy: d.countedBy,
    status: d.status,
    remarks: d.remarks,
  };
}

export const inventoryRequestsService = {
  // ── Item requests ──
  async listRequests(schoolId: string, query: { status?: string; dept?: string; mine?: string }) {
    const filter: Record<string, unknown> = { schoolId };
    if (query.status && query.status !== 'all') filter.status = query.status;
    if (query.dept && query.dept !== 'all') filter.department = query.dept;
    if (query.mine) filter.requestedById = query.mine;
    const docs = await ItemRequestModel.find(filter).sort({ createdAt: -1 }).lean();
    return docs.map(toRequest);
  },
  async createRequest(schoolId: string, payload: Record<string, unknown>) {
    const { id: _ignored, status: _status, ...rest } = payload;
    const doc = await ItemRequestModel.create({ schoolId, ...rest, status: 'pending' });
    return toRequest(doc.toObject());
  },
  async setRequestStatus(
    schoolId: string,
    id: string,
    action: 'approve' | 'reject' | 'forward' | 'cancel',
    extras: { approvedBy?: string; rejectionReason?: string },
  ) {
    const doc = await ItemRequestModel.findOne({ _id: id, schoolId });
    if (!doc) throw ApiError.notFound('Request not found');

    if (action === 'approve') {
      const value = (doc.quantity ?? 0) * (doc.unitPrice ?? 0);
      if (value > FORWARD_THRESHOLD_INR && doc.status !== 'forwarded') {
        throw ApiError.badRequest(`Requests above ₹${FORWARD_THRESHOLD_INR.toLocaleString()} must be forwarded for approval first`);
      }
      doc.status = 'approved';
      doc.approvedBy = extras.approvedBy ?? doc.approvedBy;
      doc.approvedOn = new Date().toISOString();
    } else if (action === 'reject') {
      doc.status = 'rejected';
      doc.rejectionReason = extras.rejectionReason ?? doc.rejectionReason;
    } else if (action === 'forward') {
      doc.status = 'forwarded';
    } else {
      doc.status = 'cancelled';
    }
    await doc.save();
    return toRequest(doc.toObject());
  },

  // ── Stock mismatches / count ──
  async listMismatches(schoolId: string) {
    const docs = await StockMismatchModel.find({ schoolId }).sort({ createdAt: -1 }).lean();
    return docs.map(toMismatch);
  },
  async recordMismatch(schoolId: string, rows: Array<Record<string, unknown>>) {
    const docs = await StockMismatchModel.insertMany(rows.map((r) => ({ schoolId, ...r })));
    return docs.map((d) => toMismatch(d.toObject()));
  },
  async updateMismatchStatus(schoolId: string, id: string, status: string, remarks?: string) {
    const doc = await StockMismatchModel.findOneAndUpdate(
      { _id: id, schoolId },
      { $set: { status, ...(remarks !== undefined ? { remarks } : {}) } },
      { new: true },
    );
    if (!doc) throw ApiError.notFound('Mismatch not found');
    return toMismatch(doc.toObject());
  },

  // ── Department stock (derived from stock issues) ──
  async getDeptStock(schoolId: string) {
    const issues = await StockIssueModel.find({ schoolId }).sort({ createdAt: -1 }).lean();
    const categoryByItemId = await categoryLookup(schoolId);
    const now = Date.now();
    const rows: Array<Record<string, unknown>> = [];
    for (const issue of issues) {
      const items = (issue.items as Array<{ itemId: string; itemName: string; quantity: number }> | undefined) ?? [];
      const status =
        issue.status === 'returned'
          ? 'returned'
          : issue.returnDate && new Date(issue.returnDate).getTime() < now
            ? 'overdue'
            : 'with_dept';
      for (const item of items) {
        rows.push({
          id: `${String(issue._id)}_${item.itemId}`,
          itemId: item.itemId,
          itemName: item.itemName,
          category: categoryByItemId.get(item.itemId) ?? '',
          quantity: item.quantity,
          issuedOn: issue.date,
          issuedTo: issue.issuedTo,
          returnDue: issue.returnDate,
          status,
          department: issue.department,
        });
      }
    }
    return rows;
  },

  // ── My assigned items (issued to the current logged-in user by name) ──
  async getMyItems(schoolId: string, userId: string) {
    const user = await UserModel.findById(userId).lean();
    if (!user) return [];
    const issues = await StockIssueModel.find({ schoolId, issuedTo: user.name }).sort({ createdAt: -1 }).lean();
    const categoryByItemId = await categoryLookup(schoolId);
    const rows: Array<Record<string, unknown>> = [];
    for (const issue of issues) {
      const items = (issue.items as Array<{ itemId: string; itemName: string; quantity: number }> | undefined) ?? [];
      for (const item of items) {
        rows.push({
          id: `${String(issue._id)}_${item.itemId}`,
          itemId: item.itemId,
          itemName: item.itemName,
          category: categoryByItemId.get(item.itemId) ?? '',
          issuedOn: issue.date,
          returnDue: issue.returnDate,
          condition: 'good',
        });
      }
    }
    return rows;
  },
};

async function categoryLookup(schoolId: string): Promise<Map<string, string>> {
  const items = await InventoryItemModel.find({ schoolId }).select('category').lean();
  return new Map(items.map((i) => [String(i._id), i.category ?? '']));
}
