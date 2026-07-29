import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { transportTrackingService } from './transport-tracking.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
const p = (req: Request, key: string): string => String(req.params[key]);

export const transportTrackingController = {
  async getMaintenance(req: Request, res: Response) {
    send(res, await transportTrackingService.getMaintenance(schoolId(req), p(req, 'id')));
  },
  async addMaintenance(req: Request, res: Response) {
    created(res, await transportTrackingService.addMaintenance(schoolId(req), p(req, 'id'), req.body));
  },
  async getTripHistory(req: Request, res: Response) {
    send(res, await transportTrackingService.getTripHistory(schoolId(req), p(req, 'id')));
  },
  async getLivePositions(req: Request, res: Response) {
    send(res, await transportTrackingService.getLivePositions(schoolId(req)));
  },
  async getGpsDevices(req: Request, res: Response) {
    send(res, await transportTrackingService.getGpsDevices(schoolId(req)));
  },
  async saveGpsDevice(req: Request, res: Response) {
    created(res, await transportTrackingService.saveGpsDevice(schoolId(req), req.body));
  },
};
