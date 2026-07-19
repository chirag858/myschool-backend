import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { receptionService } from './reception.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
const p = (req: Request, key: string): string => String(req.params[key]);

export const receptionController = {
  async dashboard(req: Request, res: Response) {
    send(res, await receptionService.dashboard(schoolId(req)));
  },
  async getAppointments(req: Request, res: Response) {
    const date = typeof req.query.date === 'string' ? req.query.date : undefined;
    send(res, await receptionService.getAppointments(schoolId(req), date));
  },
  async createAppointment(req: Request, res: Response) {
    created(res, await receptionService.createAppointment(schoolId(req), req.body));
  },
  async setAppointmentStatus(req: Request, res: Response) {
    const { status } = req.body as { status: string };
    send(res, await receptionService.setAppointmentStatus(schoolId(req), p(req, 'id'), status));
  },
  async getCallLogs(req: Request, res: Response) {
    send(res, await receptionService.getCallLogs(schoolId(req)));
  },
  async createCallLog(req: Request, res: Response) {
    created(res, await receptionService.createCallLog(schoolId(req), req.body));
  },
  async markFollowUpDone(req: Request, res: Response) {
    send(res, await receptionService.markFollowUpDone(schoolId(req), p(req, 'id')));
  },
};
