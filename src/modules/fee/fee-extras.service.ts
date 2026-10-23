import { ApiError } from '../../lib/api-error';
import {
  AppliedConcessionModel,
  AppliedFineModel,
  ConcessionApprovalModel,
  ConcessionModel,
  FineRuleModel,
} from './fee-extras.models';

type Doc = Record<string, unknown> & { _id: unknown };
const isId = (v: unknown): boolean => /^[0-9a-fA-F]{24}$/.test(String(v ?? ''));
const nowIso = (): string => new Date().toISOString();
const today = (): string => nowIso().slice(0, 10);

/** Strips tenant/identity fields a client must never be able to set via spread/$set. */
function stripOwned<T extends Record<string, unknown>>(payload: T): Omit<T, 'schoolId' | '_id' | 'id'> {
  const { schoolId: _s, _id: _i, id: _d, ...rest } = payload;
  void _s; void _i; void _d;
  return rest;
}

function dto(d: Doc): Record<string, unknown> {
  const { _id, __v, schoolId, createdAt, updatedAt, ...rest } = d as Record<string, unknown>;
  void __v;
  void schoolId;
  void createdAt;
  void updatedAt;
  return { id: String(_id), ...rest };
}

export const feeExtrasService = {
  // ── Fine rules ──
  async listFineRules(schoolId: string) {
    return (await FineRuleModel.find({ schoolId }).sort({ createdAt: -1 }).lean()).map(dto);
  },
  async createFineRule(schoolId: string, payload: Record<string, unknown>) {
    const doc = await FineRuleModel.create({ ...stripOwned(payload), schoolId });
    return dto(doc.toObject());
  },
  async updateFineRule(schoolId: string, id: string, payload: Record<string, unknown>) {
    const doc = await FineRuleModel.findOneAndUpdate({ _id: id, schoolId }, { $set: stripOwned(payload) }, { new: true });
    if (!doc) throw ApiError.notFound('Fine rule not found');
    return dto(doc.toObject());
  },
  async deleteFineRule(schoolId: string, id: string) {
    await FineRuleModel.deleteOne({ _id: id, schoolId });
    return { success: true };
  },

  // ── Applied fines ──
  async listAppliedFines(schoolId: string) {
    return (await AppliedFineModel.find({ schoolId }).sort({ createdAt: -1 }).lean()).map(dto);
  },
  async waiveFine(schoolId: string, id: string, reason: string, by: string) {
    const doc = await AppliedFineModel.findOneAndUpdate(
      { _id: id, schoolId, status: 'pending' },
      { status: 'waived', waivedBy: by, waivedReason: reason, waivedAt: nowIso() },
      { new: true },
    );
    if (!doc) throw ApiError.badRequest('Applied fine not found or not pending');
    return dto(doc.toObject());
  },

  // ── Concessions ──
  async listConcessions(schoolId: string) {
    return (await ConcessionModel.find({ schoolId }).sort({ createdAt: -1 }).lean()).map(dto);
  },
  async createConcession(schoolId: string, payload: Record<string, unknown>) {
    const count = await ConcessionModel.countDocuments({ schoolId });
    const code = (payload.code as string) || `CON${String(count + 1).padStart(3, '0')}`;
    const doc = await ConcessionModel.create({ ...stripOwned(payload), schoolId, code });
    return dto(doc.toObject());
  },
  async updateConcession(schoolId: string, id: string, payload: Record<string, unknown>) {
    const doc = await ConcessionModel.findOneAndUpdate({ _id: id, schoolId }, { $set: stripOwned(payload) }, { new: true });
    if (!doc) throw ApiError.notFound('Concession not found');
    return dto(doc.toObject());
  },
  async deleteConcession(schoolId: string, id: string) {
    await ConcessionModel.deleteOne({ _id: id, schoolId });
    return { success: true };
  },

  // ── Applied concessions ──
  async listAppliedConcessions(schoolId: string) {
    return (await AppliedConcessionModel.find({ schoolId }).sort({ createdAt: -1 }).lean()).map(dto);
  },
  async applyConcession(schoolId: string, payload: Record<string, unknown>, appliedBy: string) {
    const concession = await ConcessionModel.findOne({ _id: payload.concessionId, schoolId }).lean();
    if (!concession) throw ApiError.notFound('Concession not found');

    const duplicate = await AppliedConcessionModel.findOne({
      schoolId,
      studentId: payload.studentId,
      concessionId: String(concession._id),
      approvalStatus: { $in: ['pending', 'active'] },
    }).lean();
    if (duplicate) throw ApiError.badRequest('This concession is already applied (or pending) for this student');

    // Value always comes from the concession's own configured value — a client override is
    // only honoured when it's a reduction (never raises the discount past what was configured).
    const configuredValue = Number(concession.value) || 0;
    const requestedValue = Number(payload.value);
    const value = Number.isFinite(requestedValue) && requestedValue >= 0 && requestedValue <= configuredValue
      ? requestedValue
      : configuredValue;

    const requiresApproval = Boolean(concession.requiresApproval);
    const doc = await AppliedConcessionModel.create({
      schoolId,
      studentId: payload.studentId,
      studentName: payload.studentName,
      className: payload.className,
      concessionId: String(concession._id),
      concessionName: concession.name,
      category: concession.category,
      value,
      calcType: concession.calcType,
      appliedToHeads: concession.targetFeeHeads,
      appliedBy,
      approvalStatus: requiresApproval ? 'pending' : 'active',
      effectiveFrom: (payload.effectiveFrom as string) ?? today(),
    });
    if (requiresApproval) {
      await ConcessionApprovalModel.create({
        schoolId,
        appliedConcessionId: String(doc._id),
        studentName: payload.studentName,
        className: payload.className,
        concessionName: concession.name,
        concessionCategory: concession.category,
        requestedBy: appliedBy,
        requestedAt: nowIso(),
        status: 'pending',
        currentLevel: 1,
        history: [],
      });
    }
    return dto(doc.toObject());
  },
  async revokeAppliedConcession(schoolId: string, id: string, reason: string) {
    const doc = await AppliedConcessionModel.findOneAndUpdate(
      { _id: id, schoolId },
      { approvalStatus: 'revoked', revokeReason: reason, revokedAt: nowIso() },
      { new: true },
    );
    if (!doc) throw ApiError.notFound('Applied concession not found');
    // A revoked concession must not be silently reactivated by a pending approval later.
    await ConcessionApprovalModel.updateMany(
      { schoolId, appliedConcessionId: String(doc._id), status: 'pending' },
      { $set: { status: 'rejected' } },
    );
    return dto(doc.toObject());
  },

  // ── Concession approvals ──
  async listApprovals(schoolId: string) {
    return (await ConcessionApprovalModel.find({ schoolId }).sort({ createdAt: -1 }).lean()).map(dto);
  },
  async reviewApproval(schoolId: string, id: string, action: 'approve' | 'reject', remarks: string, actor: { name: string; id: string }) {
    const approval = await ConcessionApprovalModel.findOne({ _id: id, schoolId, status: 'pending' });
    if (!approval) throw ApiError.badRequest('Approval not found or not pending');
    if (approval.requestedBy === actor.id || approval.requestedBy === actor.name) {
      throw ApiError.forbidden('Cannot review your own concession request');
    }
    const status = action === 'approve' ? 'approved' : 'rejected';
    approval.status = status;
    approval.history = [
      ...approval.history,
      { level: approval.currentLevel, actor: actor.name, action: status, remarks, at: nowIso() },
    ];
    await approval.save();
    if (approval.appliedConcessionId) {
      await AppliedConcessionModel.updateOne(
        { _id: approval.appliedConcessionId, schoolId, approvalStatus: 'pending' },
        { approvalStatus: action === 'approve' ? 'active' : 'rejected' },
      );
    }
    return dto(approval.toObject());
  },
};
