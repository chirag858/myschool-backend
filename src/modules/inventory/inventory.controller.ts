import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { inventoryService } from './inventory.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
const p = (req: Request, key: string): string => String(req.params[key]);
const q = (req: Request): Record<string, string> => req.query as Record<string, string>;
const actor = (req: Request): string => String(req.user?.role ?? 'admin');

export const inventoryController = {
  async kpi(req: Request, res: Response) {
    send(res, await inventoryService.kpi(schoolId(req)));
  },
  async getItems(req: Request, res: Response) {
    send(res, await inventoryService.getItems(schoolId(req), q(req)));
  },
  async getItem(req: Request, res: Response) {
    send(res, await inventoryService.getItem(schoolId(req), p(req, 'id')));
  },
  async upsertItem(req: Request, res: Response) {
    created(res, await inventoryService.upsertItem(schoolId(req), req.body));
  },
  async getMovements(req: Request, res: Response) {
    send(res, await inventoryService.getMovements(schoolId(req), p(req, 'id')));
  },
  async getPurchases(req: Request, res: Response) {
    send(res, await inventoryService.getPurchases(schoolId(req)));
  },
  async addPurchase(req: Request, res: Response) {
    created(res, await inventoryService.addPurchase(schoolId(req), req.body, actor(req)));
  },
  async getIssues(req: Request, res: Response) {
    send(res, await inventoryService.getIssues(schoolId(req)));
  },
  async addIssue(req: Request, res: Response) {
    created(res, await inventoryService.addIssue(schoolId(req), req.body));
  },
  async getVendors(req: Request, res: Response) {
    send(res, await inventoryService.getVendors(schoolId(req)));
  },
  async upsertVendor(req: Request, res: Response) {
    created(res, await inventoryService.upsertVendor(schoolId(req), req.body));
  },
  async getAssets(req: Request, res: Response) {
    send(res, await inventoryService.getAssets(schoolId(req)));
  },
  async upsertAsset(req: Request, res: Response) {
    created(res, await inventoryService.upsertAsset(schoolId(req), req.body));
  },
};
