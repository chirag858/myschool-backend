import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { messagingService } from './messaging.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
const p = (req: Request, key: string): string => String(req.params[key]);

export const messagingController = {
  async getMessages(req: Request, res: Response) {
    send(res, await messagingService.getMessages(schoolId(req)));
  },
  async sendMessage(req: Request, res: Response) {
    created(res, await messagingService.sendMessage(schoolId(req), req.body));
  },
  async getDeliveryReport(req: Request, res: Response) {
    send(res, await messagingService.getDeliveryReport(schoolId(req), p(req, 'id')));
  },
  async resendFailed(req: Request, res: Response) {
    send(res, await messagingService.resendFailed(schoolId(req), p(req, 'id')));
  },
  async getTemplates(req: Request, res: Response) {
    send(res, await messagingService.getTemplates(schoolId(req)));
  },
  async upsertTemplate(req: Request, res: Response) {
    created(res, await messagingService.upsertTemplate(schoolId(req), req.body));
  },
  async deleteTemplate(req: Request, res: Response) {
    send(res, await messagingService.deleteTemplate(schoolId(req), p(req, 'id')));
  },
};
