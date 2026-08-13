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
    const doc = await FineRuleModel.create({ schoolId, ...payload });
    return dto(doc.toObject());
  },
  async updateFineRule(schoolId: string, id: string, payload: Record<string, unknown>) {
    const doc = await FineRuleModel.findOneAndUpdate({ _id: id, schoolId }, { $set: payload }, { new: true });
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
      { _id: id, schoolId },
      { status: 'waived', waivedBy: by, waivedReason: reason, waivedAt: nowIso() },
      { new: true },
    );
    if (!doc) throw ApiError.notFound('Applied fine not found');
    return dto(doc.toObject());
  },

  // ── Concessions ──
  async listConcessions(schoolId: string) {
    return (await ConcessionModel.find({ schoolId }).sort({ createdAt: -1 }).lean()).map(dto);
  },
  async createConcession(schoolId: string, payload: Record<string, unknown>) {
    const count = await ConcessionModel.countDocuments({ schoolId });
    const code = (payload.code as string) || `CON${String(count + 1).padStart(3, '0')}`;
    const doc = await ConcessionModel.create({ schoolId, ...payload, code });
    return dto(doc.toObject());
  },
  async updateConcession(schoolId: string, id: string, payload: Record<string, unknown>) {
    const doc = await ConcessionModel.findOneAndUpdate({ _id: id, schoolId }, { $set: payload }, { new: true });
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
    const requiresApproval = Boolean(concession.requiresApproval);
    const doc = await AppliedConcessionModel.create({
      schoolId,
      studentId: payload.studentId,
      studentName: payload.studentName,
      className: payload.className,
      concessionId: String(concession._id),
      concessionName: concession.name,
      category: concession.category,
      value: (payload.value as number) ?? concession.value,
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
    return dto(doc.toObject());
  },

  // ── Concession approvals ──
  async listApprovals(schoolId: string) {
    return (await ConcessionApprovalModel.find({ schoolId }).sort({ createdAt: -1 }).lean()).map(dto);
  },
  async reviewApproval(schoolId: string, id: string, action: 'approve' | 'reject', remarks: string, actor: string) {
    const approval = await ConcessionApprovalModel.findOne({ _id: id, schoolId });
    if (!approval) throw ApiError.notFound('Approval not found');
    const status = action === 'approve' ? 'approved' : 'rejected';
    approval.status = status;
    approval.history = [
      ...approval.history,
      { level: approval.currentLevel, actor, action: status, remarks, at: nowIso() },
    ];
    await approval.save();
    if (approval.appliedConcessionId) {
      await AppliedConcessionModel.updateOne(
        { _id: approval.appliedConcessionId, schoolId },
        { approvalStatus: action === 'approve' ? 'active' : 'rejected' },
      );
    }
    return dto(approval.toObject());
  },
};
