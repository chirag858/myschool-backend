import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { UserModel } from '../user/user.model';
import { feeExtrasService } from './fee-extras.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
const p = (req: Request, key: string): string => String(req.params[key]);
/** The user's own name/id, not their role — needed so approval/review guards can tell requester apart from reviewer. */
async function actor(req: Request): Promise<{ name: string; id: string }> {
  const u = await UserModel.findById(req.user?._id).lean();
  return { name: (u?.name as string) ?? String(req.user?.role ?? 'accountant'), id: String(req.user?._id ?? '') };
}

export const feeExtrasController = {
  // fine rules
  async listFineRules(req: Request, res: Response) {
    send(res, await feeExtrasService.listFineRules(schoolId(req)));
  },
  async createFineRule(req: Request, res: Response) {
    created(res, await feeExtrasService.createFineRule(schoolId(req), req.body));
  },
  async updateFineRule(req: Request, res: Response) {
    send(res, await feeExtrasService.updateFineRule(schoolId(req), p(req, 'id'), req.body));
  },
  async deleteFineRule(req: Request, res: Response) {
    send(res, await feeExtrasService.deleteFineRule(schoolId(req), p(req, 'id')));
  },

  // applied fines
  async listAppliedFines(req: Request, res: Response) {
    send(res, await feeExtrasService.listAppliedFines(schoolId(req)));
  },
  async waiveFine(req: Request, res: Response) {
    const { reason } = req.body as { reason: string };
    send(res, await feeExtrasService.waiveFine(schoolId(req), p(req, 'id'), reason, (await actor(req)).name));
  },

  // concessions
  async listConcessions(req: Request, res: Response) {
    send(res, await feeExtrasService.listConcessions(schoolId(req)));
  },
  async createConcession(req: Request, res: Response) {
    created(res, await feeExtrasService.createConcession(schoolId(req), req.body));
  },
  async updateConcession(req: Request, res: Response) {
    send(res, await feeExtrasService.updateConcession(schoolId(req), p(req, 'id'), req.body));
  },
  async deleteConcession(req: Request, res: Response) {
    send(res, await feeExtrasService.deleteConcession(schoolId(req), p(req, 'id')));
  },

  // applied concessions
  async listAppliedConcessions(req: Request, res: Response) {
    send(res, await feeExtrasService.listAppliedConcessions(schoolId(req)));
  },
  async applyConcession(req: Request, res: Response) {
    created(res, await feeExtrasService.applyConcession(schoolId(req), req.body, (await actor(req)).name));
  },
  async revokeAppliedConcession(req: Request, res: Response) {
    const { reason } = req.body as { reason: string };
    send(res, await feeExtrasService.revokeAppliedConcession(schoolId(req), p(req, 'id'), reason ?? ''));
  },

  // approvals
  async listApprovals(req: Request, res: Response) {
    send(res, await feeExtrasService.listApprovals(schoolId(req)));
  },
  async reviewApproval(req: Request, res: Response) {
    const { action, remarks } = req.body as { action: 'approve' | 'reject'; remarks?: string };
    send(res, await feeExtrasService.reviewApproval(schoolId(req), p(req, 'id'), action, remarks ?? '', await actor(req)));
  },
};
