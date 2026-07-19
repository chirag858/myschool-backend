import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { UserModel } from '../user/user.model';
import { feeAdjustService } from './fee-adjust.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
async function actor(req: Request): Promise<{ name: string; ip: string }> {
  const u = await UserModel.findById(req.user?._id).lean();
  return { name: (u?.name as string) ?? 'System', ip: req.ip ?? '' };
}
const p = (req: Request, key: string): string => String(req.params[key]);

export const feeAdjustController = {
  async createReadjustment(req: Request, res: Response) {
    created(res, await feeAdjustService.createReadjustment(schoolId(req), p(req, 'type'), await actor(req), req.body));
  },
  async getReadjustmentHistory(req: Request, res: Response) {
    send(res, await feeAdjustService.getReadjustmentHistory(schoolId(req)));
  },

  async requestWaiveOff(req: Request, res: Response) {
    created(res, await feeAdjustService.requestWaiveOff(schoolId(req), await actor(req), req.body));
  },
  async getWaiveOffQueue(req: Request, res: Response) {
    send(res, await feeAdjustService.getWaiveOffQueue(schoolId(req), req.query.status ? String(req.query.status) : undefined));
  },
  async approveWaiveOff(req: Request, res: Response) {
    const { remarks } = req.body as { remarks?: string };
    send(res, await feeAdjustService.approveWaiveOff(schoolId(req), p(req, 'id'), remarks ?? '', await actor(req)));
  },
  async rejectWaiveOff(req: Request, res: Response) {
    const { reason } = req.body as { reason: string };
    send(res, await feeAdjustService.rejectWaiveOff(schoolId(req), p(req, 'id'), reason));
  },
  async getWaiveOffHistory(req: Request, res: Response) {
    send(res, await feeAdjustService.getWaiveOffHistory(schoolId(req), q(req, 'dateFrom'), q(req, 'dateTo')));
  },

  async generateReport(req: Request, res: Response) {
    send(res, await feeAdjustService.generateReport(schoolId(req), p(req, 'type'), req.query as Record<string, string>));
  },
};

function q(req: Request, key: string): string | undefined {
  const v = req.query[key];
  return v == null ? undefined : String(v);
}
