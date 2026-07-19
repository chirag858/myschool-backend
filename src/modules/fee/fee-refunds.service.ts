import { ApiError } from '../../lib/api-error';
import { RefundRequestModel } from './fee-refunds.models';

type Doc = Record<string, unknown> & { _id: unknown };
const nowIso = (): string => new Date().toISOString();

function view(d: Doc, userId: string): Record<string, unknown> {
  return {
    id: String(d._id),
    studentId: d.studentId,
    studentName: d.studentName,
    className: d.className,
    amount: d.amount,
    refundMode: d.refundMode,
    reference: d.reference,
    reason: d.reason,
    requestedAt: d.requestedAt,
    requestedBy: d.requestedBy,
    raisedByMe: String(d.requestedById) === userId,
    status: d.status,
    approvedBy: d.approvedBy,
    approvedAt: d.approvedAt,
    rejectedAt: d.rejectedAt,
    rejectionReason: d.rejectionReason,
  };
}

export const feeRefundsService = {
  async list(schoolId: string, userId: string, raisedBy?: string) {
    const filter: Record<string, unknown> = { schoolId };
    if (raisedBy === 'me') filter.requestedById = userId;
    const rows = await RefundRequestModel.find(filter).sort({ requestedAt: -1 }).lean();
    return rows.map((r) => view(r as unknown as Doc, userId));
  },

  async create(schoolId: string, actor: { id: string; name: string }, payload: Record<string, unknown>) {
    const doc = await RefundRequestModel.create({
      schoolId,
      studentId: payload.studentId,
      studentName: payload.studentName,
      className: payload.className,
      amount: Number(payload.amount ?? 0),
      refundMode: payload.refundMode,
      reference: payload.reference,
      reason: payload.reason,
      requestedAt: nowIso(),
      requestedBy: actor.name,
      requestedById: actor.id,
      status: 'pending_approval',
    });
    return view(doc.toObject() as Doc, actor.id);
  },

  async cancel(schoolId: string, userId: string, id: string) {
    const r = await RefundRequestModel.deleteOne({ _id: id, schoolId, requestedById: userId });
    if (!r.deletedCount) throw ApiError.notFound('Refund request not found');
  },

  async decide(schoolId: string, userId: string, id: string, action: 'approve' | 'reject', by: string, reason?: string) {
    const patch =
      action === 'approve'
        ? { status: 'approved', approvedBy: by, approvedAt: nowIso() }
        : { status: 'rejected', rejectedAt: nowIso(), rejectionReason: reason };
    const doc = await RefundRequestModel.findOneAndUpdate({ _id: id, schoolId }, { $set: patch }, { new: true });
    if (!doc) throw ApiError.notFound('Refund request not found');
    return view(doc.toObject() as Doc, userId);
  },
};
