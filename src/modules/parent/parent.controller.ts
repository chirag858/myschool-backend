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
const q = (req: Request, key: string): string | undefined => {
  const v = req.query[key];
  return v == null ? undefined : String(v);
};

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
  async listReceipts(req: Request, res: Response) {
    send(res, await parentService.listReceipts(schoolId(req), userId(req), childId(req)));
  },
  async getReceipt(req: Request, res: Response) {
    send(res, await parentService.getReceipt(schoolId(req), userId(req), String(req.params.id)));
  },
  async getAttendance(req: Request, res: Response) {
    send(res, await parentService.getAttendance(schoolId(req), userId(req), childId(req)));
  },
  async getCirculars(req: Request, res: Response) {
    send(res, await parentService.getCirculars(schoolId(req)));
  },
  async getMeetLinks(req: Request, res: Response) {
    send(res, await parentService.getMeetLinks(schoolId(req), userId(req), childId(req)));
  },
  async getHomework(req: Request, res: Response) {
    send(res, await parentService.getHomework(schoolId(req), userId(req), childId(req), { type: q(req, 'type') }));
  },
  async getComplaints(req: Request, res: Response) {
    send(res, await parentService.getComplaints(schoolId(req), userId(req), childId(req)));
  },
  async submitComplaint(req: Request, res: Response) {
    created(res, await parentService.submitComplaint(schoolId(req), userId(req), req.body));
  },
};
