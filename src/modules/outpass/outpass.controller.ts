import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { outpassService } from './outpass.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}

export const outpassController = {
  async list(req: Request, res: Response) {
    send(res, await outpassService.list(schoolId(req)));
  },
  async issue(req: Request, res: Response) {
    created(res, await outpassService.issue(schoolId(req), req.user?._id, req.body));
  },
  async recordReturn(req: Request, res: Response) {
    send(res, await outpassService.recordReturn(schoolId(req), String(req.params.id)));
  },
  async cancel(req: Request, res: Response) {
    send(res, await outpassService.cancel(schoolId(req), String(req.params.id)));
  },
  async sendOtp(_req: Request, res: Response) {
    send(res, outpassService.sendOtp());
  },
  async listVisitors(req: Request, res: Response) {
    send(res, await outpassService.listVisitors(schoolId(req)));
  },
  async addVisitor(req: Request, res: Response) {
    created(res, await outpassService.addVisitor(schoolId(req), req.body));
  },
  async checkoutVisitor(req: Request, res: Response) {
    send(res, await outpassService.checkoutVisitor(schoolId(req), String(req.params.id)));
  },
};
