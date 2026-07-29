import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { feeRecoveryService } from './fee-recovery.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
const p = (req: Request, key: string): string => String(req.params[key]);

export const feeRecoveryController = {
  async dashboard(req: Request, res: Response) {
    send(res, await feeRecoveryService.getDashboard(schoolId(req)));
  },

  async listPlans(req: Request, res: Response) {
    send(res, await feeRecoveryService.listPlans(schoolId(req)));
  },
  async createPlan(req: Request, res: Response) {
    created(res, await feeRecoveryService.createPlan(schoolId(req), req.body));
  },
  async updatePlan(req: Request, res: Response) {
    send(res, await feeRecoveryService.updatePlan(schoolId(req), p(req, 'id'), req.body));
  },

  async listStudentInstallments(req: Request, res: Response) {
    send(res, await feeRecoveryService.listStudentInstallments(schoolId(req)));
  },
  async assignInstallment(req: Request, res: Response) {
    created(res, await feeRecoveryService.assignInstallment(schoolId(req), req.body));
  },
  async removeStudentInstallment(req: Request, res: Response) {
    send(res, await feeRecoveryService.removeStudentInstallment(schoolId(req), p(req, 'id')));
  },

  async listRules(req: Request, res: Response) {
    send(res, await feeRecoveryService.listRules(schoolId(req)));
  },
  async createRule(req: Request, res: Response) {
    created(res, await feeRecoveryService.createRule(schoolId(req), req.body));
  },
  async toggleRule(req: Request, res: Response) {
    const { active } = req.body as { active: boolean };
    send(res, await feeRecoveryService.toggleRule(schoolId(req), p(req, 'id'), active));
  },
  async deleteRule(req: Request, res: Response) {
    send(res, await feeRecoveryService.deleteRule(schoolId(req), p(req, 'id')));
  },
  async getReminderLog(req: Request, res: Response) {
    send(res, await feeRecoveryService.getReminderLog(schoolId(req)));
  },

  async listSiblingGroups(req: Request, res: Response) {
    send(res, await feeRecoveryService.listSiblingGroups(schoolId(req)));
  },
  async scanSiblings(req: Request, res: Response) {
    send(res, await feeRecoveryService.scanSiblings(schoolId(req)));
  },
  async applySiblingDiscount(req: Request, res: Response) {
    send(res, await feeRecoveryService.applySiblingDiscount(schoolId(req), p(req, 'id')));
  },
  async bulkApplySiblingDiscount(req: Request, res: Response) {
    send(res, await feeRecoveryService.bulkApplySiblingDiscount(schoolId(req)));
  },

  async getDefaulters(req: Request, res: Response) {
    const q = req.query as Record<string, string>;
    send(
      res,
      await feeRecoveryService.getDefaulters(schoolId(req), {
        classKey: q.classKey,
        minDaysOverdue: q.minDaysOverdue ? Number(q.minDaysOverdue) : undefined,
        minAmount: q.minAmount ? Number(q.minAmount) : undefined,
      }),
    );
  },
  async sendReminder(req: Request, res: Response) {
    const { studentIds, channel } = req.body as { studentIds: string[]; channel: 'sms' | 'whatsapp' | 'both' };
    send(res, await feeRecoveryService.sendReminder(schoolId(req), studentIds, channel));
  },
};
