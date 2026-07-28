import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { feeService } from './fee.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
/** Like schoolId(), but super_admin gets `undefined` (cross-tenant) instead of a 403 —
 * used by the receipt endpoints the platform-wide Utilize tool needs. */
function tenantScope(req: Request): string | undefined {
  if (req.user?.role === 'super_admin') return req.user.schoolId;
  return schoolId(req);
}
const actor = (req: Request): string => String(req.user?.role ?? 'accountant');
const p = (req: Request, key: string): string => String(req.params[key]);

export const feeController = {
  // heads
  async listHeads(req: Request, res: Response) {
    send(res, await feeService.listHeads(schoolId(req)));
  },
  async createHead(req: Request, res: Response) {
    created(res, await feeService.createHead(schoolId(req), req.body));
  },
  async updateHead(req: Request, res: Response) {
    send(res, await feeService.updateHead(schoolId(req), p(req, 'id'), req.body));
  },
  async removeHead(req: Request, res: Response) {
    send(res, await feeService.removeHead(schoolId(req), p(req, 'id')));
  },
  async reorderHeads(req: Request, res: Response) {
    send(res, await feeService.reorderHeads(schoolId(req), req.body as string[]));
  },

  // structure
  async getStructure(req: Request, res: Response) {
    send(res, await feeService.getStructure(schoolId(req)));
  },
  async saveStructure(req: Request, res: Response) {
    send(res, await feeService.saveStructure(schoolId(req), req.body));
  },
  async copyFromSession(req: Request, res: Response) {
    send(res, await feeService.copyFromSession(schoolId(req)));
  },

  // collection
  async studentContext(req: Request, res: Response) {
    send(res, await feeService.studentContext(schoolId(req), p(req, 'studentId')));
  },
  async collect(req: Request, res: Response) {
    created(res, await feeService.collect(schoolId(req), req.body, actor(req)));
  },

  // receipts
  async listReceipts(req: Request, res: Response) {
    send(res, await feeService.listReceipts(tenantScope(req), req.query as Record<string, string>));
  },
  async getReceipt(req: Request, res: Response) {
    send(res, await feeService.getReceipt(tenantScope(req), p(req, 'id')));
  },
  async duplicateReceipt(req: Request, res: Response) {
    send(res, await feeService.duplicateReceipt(tenantScope(req), p(req, 'id')));
  },
  async cancelReceipt(req: Request, res: Response) {
    const { reason } = req.body as { reason: string };
    send(res, await feeService.cancelReceipt(tenantScope(req), p(req, 'id'), reason, actor(req)));
  },
  async stats(req: Request, res: Response) {
    send(res, await feeService.stats(schoolId(req)));
  },

  // ledger
  async ledger(req: Request, res: Response) {
    send(res, await feeService.ledger(schoolId(req), req.query as Record<string, string>));
  },

  // student ledger (single student — used by student profile fee tab)
  async studentLedger(req: Request, res: Response) {
    send(res, await feeService.studentLedger(schoolId(req), p(req, 'studentId')));
  },
};
