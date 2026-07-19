import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { transportService } from './transport.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
const p = (req: Request, key: string): string => String(req.params[key]);
const q = (req: Request): Record<string, string> => req.query as Record<string, string>;

export const transportController = {
  async kpi(req: Request, res: Response) {
    send(res, await transportService.kpi(schoolId(req)));
  },
  async getVehicles(req: Request, res: Response) {
    send(res, await transportService.getVehicles(schoolId(req), q(req)));
  },
  async getVehicle(req: Request, res: Response) {
    send(res, await transportService.getVehicle(schoolId(req), p(req, 'id')));
  },
  async createVehicle(req: Request, res: Response) {
    created(res, await transportService.createVehicle(schoolId(req), req.body));
  },
  async updateVehicle(req: Request, res: Response) {
    send(res, await transportService.updateVehicle(schoolId(req), p(req, 'id'), req.body));
  },
  async changeVehicleStatus(req: Request, res: Response) {
    const { status } = req.body as { status: string };
    send(res, await transportService.changeVehicleStatus(schoolId(req), p(req, 'id'), status));
  },
  async getDrivers(req: Request, res: Response) {
    send(res, await transportService.getDrivers(schoolId(req)));
  },
  async createDriver(req: Request, res: Response) {
    created(res, await transportService.createDriver(schoolId(req), req.body));
  },
  async updateDriver(req: Request, res: Response) {
    send(res, await transportService.updateDriver(schoolId(req), p(req, 'id'), req.body));
  },
  async getRoutes(req: Request, res: Response) {
    send(res, await transportService.getRoutes(schoolId(req)));
  },
  async getRoute(req: Request, res: Response) {
    send(res, await transportService.getRoute(schoolId(req), p(req, 'id')));
  },
  async upsertRoute(req: Request, res: Response) {
    created(res, await transportService.upsertRoute(schoolId(req), req.body));
  },
  async deleteRoute(req: Request, res: Response) {
    send(res, await transportService.deleteRoute(schoolId(req), p(req, 'id')));
  },
  async getAssignments(req: Request, res: Response) {
    send(res, await transportService.getAssignments(schoolId(req), q(req)));
  },
  async upsertAssignment(req: Request, res: Response) {
    created(res, await transportService.upsertAssignment(schoolId(req), req.body));
  },
  async removeAssignment(req: Request, res: Response) {
    send(res, await transportService.removeAssignment(schoolId(req), p(req, 'id')));
  },
  // Served under /students/:id/transport
  async studentTransport(req: Request, res: Response) {
    send(res, await transportService.studentTransport(schoolId(req), p(req, 'id')));
  },
};
