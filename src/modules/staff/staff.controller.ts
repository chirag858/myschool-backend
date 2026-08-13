import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { staffService } from './staff.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
const p = (req: Request, key: string): string => String(req.params[key]);
const dateOf = (req: Request): string =>
  typeof req.query.date === 'string' ? req.query.date : new Date().toISOString().slice(0, 10);

export const staffController = {
  async list(req: Request, res: Response) {
    send(res, await staffService.getStaff(schoolId(req), req.query as Record<string, string>));
  },
  async stats(req: Request, res: Response) {
    send(res, await staffService.stats(schoolId(req)));
  },
  async generateId(req: Request, res: Response) {
    send(res, await staffService.generateEmployeeId(schoolId(req)));
  },
  async checkId(req: Request, res: Response) {
    send(res, await staffService.checkEmployeeId(schoolId(req), String(req.query.employeeId ?? '')));
  },
  async profile(req: Request, res: Response) {
    send(res, await staffService.getProfile(schoolId(req), p(req, 'id')));
  },
  async create(req: Request, res: Response) {
    created(res, await staffService.createStaff(schoolId(req), req.body));
  },
  async getCredentials(req: Request, res: Response) {
    send(res, await staffService.getCredentials(schoolId(req), p(req, 'id')));
  },
  async createCredentials(req: Request, res: Response) {
    created(res, await staffService.createCredentials(schoolId(req), p(req, 'id'), req.body));
  },
  async updateCredentials(req: Request, res: Response) {
    send(res, await staffService.updateCredentials(schoolId(req), p(req, 'id'), req.body));
  },
  async resetPassword(req: Request, res: Response) {
    const { password } = req.body as { password?: string };
    send(res, await staffService.resetPassword(schoolId(req), p(req, 'id'), password));
  },
  async getIncharge(req: Request, res: Response) {
    send(res, await staffService.getIncharge(schoolId(req), p(req, 'id')));
  },
  async setIncharge(req: Request, res: Response) {
    const { sectionId } = req.body as { sectionId: string };
    send(res, await staffService.setIncharge(schoolId(req), p(req, 'id'), sectionId));
  },
  async clearIncharge(req: Request, res: Response) {
    send(res, await staffService.clearIncharge(schoolId(req), p(req, 'id')));
  },

  async updateStatus(req: Request, res: Response) {
    const { status } = req.body as { status: string };
    send(res, await staffService.updateStatus(schoolId(req), p(req, 'id'), status));
  },
  async getAttendance(req: Request, res: Response) {
    send(res, await staffService.getAttendance(schoolId(req), dateOf(req)));
  },
  async saveAttendance(req: Request, res: Response) {
    const { date, attendance } = req.body as { date: string; attendance: [] };
    send(res, await staffService.saveAttendance(schoolId(req), date, attendance));
  },
  async lock(req: Request, res: Response) {
    const { date } = req.body as { date: string };
    send(res, await staffService.lock(schoolId(req), date));
  },
  async report(req: Request, res: Response) {
    send(res, await staffService.report(schoolId(req)));
  },
  async attendanceMonth(req: Request, res: Response) {
    send(res, await staffService.getAttendanceMonth(schoolId(req), p(req, 'id'), Number(req.query.month), Number(req.query.year)));
  },
};
