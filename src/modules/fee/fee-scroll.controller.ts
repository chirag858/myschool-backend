import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { UserModel } from '../user/user.model';
import { feeScrollService } from './fee-scroll.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}

async function actor(req: Request): Promise<{ id: string; name: string }> {
  const u = await UserModel.findById(req.user?._id).lean();
  return { id: String(req.user?._id ?? ''), name: (u?.name as string) ?? 'System' };
}

function q(req: Request, key: string): string | undefined {
  const v = req.query[key];
  return v == null ? undefined : String(v);
}

export const feeScrollController = {
  async getScroll(req: Request, res: Response) {
    send(
      res,
      await feeScrollService.getScroll(schoolId(req), {
        date: String(req.query.date ?? ''),
        collectorId: String(req.query.collectorId ?? ''),
        collector: String(req.query.collector ?? ''),
        consolidated: req.query.consolidated === 'true',
      }),
    );
  },

  async openDay(req: Request, res: Response) {
    const who = await actor(req);
    send(res, await feeScrollService.openDay(schoolId(req), who.id, who.name, req.body));
  },

  async closeDay(req: Request, res: Response) {
    const who = await actor(req);
    const result = await feeScrollService.closeDay(schoolId(req), who.id, who.name, req.body);
    if (!result) throw ApiError.badRequest('No open session for this date');
    send(res, result);
  },

  async reopenDay(req: Request, res: Response) {
    const who = await actor(req);
    const result = await feeScrollService.reopenDay(schoolId(req), req.body, who.name);
    if (!result) throw ApiError.badRequest('No session found to reopen');
    send(res, result);
  },

  async addExpense(req: Request, res: Response) {
    const who = await actor(req);
    created(res, await feeScrollService.addExpense(schoolId(req), who.id, who.name, req.body));
  },

  async getAllExpenses(req: Request, res: Response) {
    send(res, await feeScrollService.getAllExpenses(schoolId(req)));
  },

  async getCollectors(req: Request, res: Response) {
    send(res, await feeScrollService.getCollectors(schoolId(req)));
  },

  async getConsolidated(req: Request, res: Response) {
    send(res, await feeScrollService.getConsolidated(schoolId(req), String(req.query.date ?? '')));
  },

  async getHistory(req: Request, res: Response) {
    send(
      res,
      await feeScrollService.getHistory(schoolId(req), {
        dateFrom: q(req, 'dateFrom'),
        dateTo: q(req, 'dateTo'),
        collectorId: q(req, 'collectorId'),
      }),
    );
  },
};
