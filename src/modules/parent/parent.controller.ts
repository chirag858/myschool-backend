import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { parentService } from './parent.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
const userId = (req: Request): string => String(req.user?._id);
const childId = (req: Request): string => String(req.query.childId ?? '');

export const parentController = {
  async getChildren(req: Request, res: Response) {
    send(res, await parentService.getChildren(schoolId(req), userId(req)));
  },
  async getFeeSummary(req: Request, res: Response) {
    send(res, await parentService.getFeeSummary(schoolId(req), userId(req), childId(req)));
  },
  async getFeeMonthly(req: Request, res: Response) {
    send(res, await parentService.getFeeMonthly(schoolId(req), userId(req), childId(req)));
  },
  async getAttendance(req: Request, res: Response) {
    send(res, await parentService.getAttendance(schoolId(req), userId(req), childId(req)));
  },
  async getCirculars(req: Request, res: Response) {
    send(res, await parentService.getCirculars(schoolId(req)));
  },
  async getComplaints(req: Request, res: Response) {
    send(res, await parentService.getComplaints(schoolId(req), userId(req), childId(req)));
  },
  async submitComplaint(req: Request, res: Response) {
    created(res, await parentService.submitComplaint(schoolId(req), userId(req), req.body));
  },
};
