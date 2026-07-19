import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { financeService } from './finance.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
const actor = (req: Request): string => String(req.user?.role ?? 'accountant');

export const financeController = {
  async getBankAccounts(req: Request, res: Response) {
    send(res, await financeService.getBankAccounts(schoolId(req)));
  },
  async getDeposits(req: Request, res: Response) {
    send(res, await financeService.getDeposits(schoolId(req)));
  },
  async recordDeposit(req: Request, res: Response) {
    created(res, await financeService.recordDeposit(schoolId(req), req.body, actor(req)));
  },
  async depositStats(req: Request, res: Response) {
    send(res, await financeService.depositStats(schoolId(req)));
  },
  async getIncome(req: Request, res: Response) {
    send(res, await financeService.getIncome(schoolId(req)));
  },
  async addIncome(req: Request, res: Response) {
    created(res, await financeService.addIncome(schoolId(req), req.body, actor(req)));
  },
  async getVendorPayments(req: Request, res: Response) {
    send(res, await financeService.getVendorPayments(schoolId(req)));
  },
  async recordVendorPayment(req: Request, res: Response) {
    created(res, await financeService.recordVendorPayment(schoolId(req), req.body, actor(req)));
  },
};
