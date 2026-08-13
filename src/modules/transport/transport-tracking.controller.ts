import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { transportTrackingService } from './transport-tracking.service';

/**
 * Tenant roles (school_admin/principal/coordinator/teacher) are scoped to
 * their own school via the JWT. super_admin/support_engineer have no
 * schoolId (cross-school roles, same as school-reports) and must pass
 * ?schoolId= to say which school they're looking at.
 */
function schoolId(req: Request): string {
  const own = req.user?.schoolId;
  if (own) return own;
  const query = typeof req.query.schoolId === 'string' ? req.query.schoolId : undefined;
  if (query) return query;
  throw ApiError.badRequest('schoolId is required for this role');
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
