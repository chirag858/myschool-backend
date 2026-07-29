import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { inventoryRequestsService } from './inventory-requests.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
const p = (req: Request, key: string): string => String(req.params[key]);

export const inventoryRequestsController = {
  async listRequests(req: Request, res: Response) {
    send(res, await inventoryRequestsService.listRequests(schoolId(req), req.query as Record<string, string>));
  },
  async createRequest(req: Request, res: Response) {
    created(res, await inventoryRequestsService.createRequest(schoolId(req), req.body));
  },
  async approve(req: Request, res: Response) {
    send(res, await inventoryRequestsService.setRequestStatus(schoolId(req), p(req, 'id'), 'approve', req.body));
  },
  async reject(req: Request, res: Response) {
    send(res, await inventoryRequestsService.setRequestStatus(schoolId(req), p(req, 'id'), 'reject', req.body));
  },
  async forward(req: Request, res: Response) {
    send(res, await inventoryRequestsService.setRequestStatus(schoolId(req), p(req, 'id'), 'forward', req.body));
  },
  async cancel(req: Request, res: Response) {
    send(res, await inventoryRequestsService.setRequestStatus(schoolId(req), p(req, 'id'), 'cancel', req.body));
  },

  async listMismatches(req: Request, res: Response) {
    send(res, await inventoryRequestsService.listMismatches(schoolId(req)));
  },
  async recordMismatch(req: Request, res: Response) {
    created(res, await inventoryRequestsService.recordMismatch(schoolId(req), req.body));
  },
  async updateMismatchStatus(req: Request, res: Response) {
    const { status, remarks } = req.body as { status: string; remarks?: string };
    send(res, await inventoryRequestsService.updateMismatchStatus(schoolId(req), p(req, 'id'), status, remarks));
  },

  async getDeptStock(req: Request, res: Response) {
    send(res, await inventoryRequestsService.getDeptStock(schoolId(req)));
  },
  async getMyItems(req: Request, res: Response) {
    const userId = String(req.user?._id);
    send(res, await inventoryRequestsService.getMyItems(schoolId(req), userId));
  },
};
