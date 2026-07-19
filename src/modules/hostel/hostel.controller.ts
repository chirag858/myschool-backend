import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { hostelService } from './hostel.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
const p = (req: Request, key: string): string => String(req.params[key]);
const q = (req: Request): Record<string, string> => req.query as Record<string, string>;
const actor = (req: Request): string => String(req.user?.role ?? 'admin');

export const hostelController = {
  async kpi(req: Request, res: Response) {
    send(res, await hostelService.kpi(schoolId(req)));
  },
  async getBuildings(req: Request, res: Response) {
    send(res, await hostelService.getBuildings(schoolId(req)));
  },
  async upsertBuilding(req: Request, res: Response) {
    created(res, await hostelService.upsertBuilding(schoolId(req), req.body));
  },
  async getRooms(req: Request, res: Response) {
    send(res, await hostelService.getRooms(schoolId(req), q(req)));
  },
  async getRoom(req: Request, res: Response) {
    send(res, await hostelService.getRoom(schoolId(req), p(req, 'id')));
  },
  async upsertRoom(req: Request, res: Response) {
    created(res, await hostelService.upsertRoom(schoolId(req), req.body));
  },
  async getStudents(req: Request, res: Response) {
    send(res, await hostelService.getStudents(schoolId(req), q(req)));
  },
  async allocate(req: Request, res: Response) {
    created(res, await hostelService.allocate(schoolId(req), req.body));
  },
  async vacate(req: Request, res: Response) {
    send(res, await hostelService.vacate(schoolId(req), p(req, 'id'), req.body));
  },
  async feeRows(req: Request, res: Response) {
    send(res, await hostelService.feeRows(schoolId(req)));
  },
  async getVisitors(req: Request, res: Response) {
    send(res, await hostelService.getVisitors(schoolId(req)));
  },
  async addVisitor(req: Request, res: Response) {
    created(res, await hostelService.addVisitor(schoolId(req), req.body, actor(req)));
  },
  async checkoutVisitor(req: Request, res: Response) {
    send(res, await hostelService.checkoutVisitor(schoolId(req), p(req, 'id')));
  },
  // Served under /students/:id/hostel
  async studentHostel(req: Request, res: Response) {
    send(res, await hostelService.studentHostel(schoolId(req), p(req, 'id')));
  },
};
