import type { Request, Response } from 'express';

import { created, send } from '../../lib/api-response';
import { superAdminService } from './superadmin.service';

const id = (req: Request): string => String(req.params.id);

export const superAdminController = {
  async infrastructure(_req: Request, res: Response) {
    send(res, superAdminService.infrastructure());
  },
  async revenueChart(_req: Request, res: Response) {
    send(res, await superAdminService.revenueChart());
  },
  async getSubscriptions(req: Request, res: Response) {
    send(res, await superAdminService.getSubscriptions(id(req)));
  },
  async renewSubscription(req: Request, res: Response) {
    created(res, await superAdminService.renewSubscription(id(req), req.body));
  },
  async billingOverview(_req: Request, res: Response) {
    send(res, await superAdminService.getBillingOverview());
  },
  async billingRenew(req: Request, res: Response) {
    created(res, await superAdminService.renewBilling(req.body));
  },
  async billingGracePeriod(req: Request, res: Response) {
    const { days } = req.body as { days: number };
    send(res, await superAdminService.addGracePeriod(id(req), days));
  },
  async getSchoolUsers(req: Request, res: Response) {
    send(res, await superAdminService.getSchoolUsers(id(req)));
  },
  async getSchoolAuditLogs(req: Request, res: Response) {
    send(res, await superAdminService.getSchoolAuditLogs(id(req)));
  },
  async getSchoolRecentActivity(req: Request, res: Response) {
    send(res, await superAdminService.getSchoolRecentActivity(id(req)));
  },
  async impersonate(req: Request, res: Response) {
    send(res, await superAdminService.impersonate(id(req)));
  },
  async getAuditLogs(req: Request, res: Response) {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 10), 1), 100);
    send(res, await superAdminService.getAuditLogs(limit));
  },
  async ticketStats(_req: Request, res: Response) {
    send(res, await superAdminService.ticketStats());
  },
  async getFullAuditLogs(req: Request, res: Response) {
    const { module, action, search } = req.query as { module?: string; action?: string; search?: string };
    send(res, await superAdminService.getFullAuditLogs({ module, action, search }));
  },
  async getAuditLogDetail(req: Request, res: Response) {
    send(res, await superAdminService.getAuditLogDetail(id(req)));
  },
};
