import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { gateManagerService } from './gate-manager.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
const userId = (req: Request): string => String(req.user?._id);
const p = (req: Request, key: string): string => String(req.params[key]);

export const gateManagerController = {
  async dashboard(req: Request, res: Response) {
    send(res, await gateManagerService.dashboard(schoolId(req)));
  },
  async searchStudents(req: Request, res: Response) {
    send(res, await gateManagerService.searchStudents(schoolId(req), String(req.query.q ?? '')));
  },
  async getPickups(req: Request, res: Response) {
    send(res, await gateManagerService.getPickups(schoolId(req)));
  },
  async releaseStudent(req: Request, res: Response) {
    created(res, await gateManagerService.releaseStudent(schoolId(req), userId(req), req.body));
  },
  async sendOtp(req: Request, res: Response) {
    send(res, gateManagerService.sendOtp(String(req.body.mobile)));
  },
  async getVisitors(req: Request, res: Response) {
    send(res, await gateManagerService.getVisitors(schoolId(req)));
  },
  async logVisitor(req: Request, res: Response) {
    created(res, await gateManagerService.logVisitor(schoolId(req), req.body));
  },
  async checkoutVisitor(req: Request, res: Response) {
    send(res, await gateManagerService.checkoutVisitor(schoolId(req), p(req, 'id')));
  },
  async getTeacherPasses(req: Request, res: Response) {
    send(res, await gateManagerService.getTeacherPasses(schoolId(req)));
  },
  async logTeacherPass(req: Request, res: Response) {
    created(res, await gateManagerService.logTeacherPass(schoolId(req), userId(req), req.body));
  },
  async returnTeacherPass(req: Request, res: Response) {
    send(res, await gateManagerService.returnTeacherPass(schoolId(req), p(req, 'id')));
  },
};
