import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { UserModel } from '../user/user.model';
import { feeRefundsService } from './fee-refunds.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
const userId = (req: Request): string => String(req.user?._id);
async function actorName(req: Request): Promise<string> {
  const u = await UserModel.findById(req.user?._id).lean();
  return (u?.name as string) ?? 'User';
}

export const feeRefundsController = {
  async list(req: Request, res: Response) {
    send(res, await feeRefundsService.list(schoolId(req), userId(req), req.query.raisedBy ? String(req.query.raisedBy) : undefined));
  },
  async create(req: Request, res: Response) {
    created(res, await feeRefundsService.create(schoolId(req), { id: userId(req), name: await actorName(req) }, req.body));
  },
  async cancel(req: Request, res: Response) {
    await feeRefundsService.cancel(schoolId(req), userId(req), String(req.params.id));
    res.status(204).end();
  },
  async decide(req: Request, res: Response) {
    const { action, reason } = req.body as { action: 'approve' | 'reject'; reason?: string };
    send(res, await feeRefundsService.decide(schoolId(req), userId(req), String(req.params.id), action, await actorName(req), reason));
  },
};
