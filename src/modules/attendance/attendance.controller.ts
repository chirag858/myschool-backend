import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { send } from '../../lib/api-response';
import { attendanceService } from './attendance.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
const actor = (req: Request): string => String(req.user?.role ?? 'admin');

export const attendanceController = {
  async markSession(req: Request, res: Response) {
    const { date, class: className, section } = req.query as Record<string, string>;
    send(res, await attendanceService.getMarkSession(schoolId(req), className, section, date));
  },
  async save(req: Request, res: Response) {
    send(res, await attendanceService.save(schoolId(req), req.body, actor(req)));
  },
  async saveAndAlert(req: Request, res: Response) {
    send(res, await attendanceService.saveAndAlert(schoolId(req), req.body, actor(req)));
  },
  async override(req: Request, res: Response) {
    send(res, await attendanceService.override(schoolId(req), req.body, actor(req)));
  },
  async overrideHistory(req: Request, res: Response) {
    send(res, await attendanceService.overrideHistory(schoolId(req)));
  },
  async dashboard(req: Request, res: Response) {
    const date = typeof req.query.date === 'string' ? req.query.date : new Date().toISOString().slice(0, 10);
    send(res, await attendanceService.dashboard(schoolId(req), date));
  },
  async dailySummary(req: Request, res: Response) {
    const date = typeof req.query.date === 'string' ? req.query.date : new Date().toISOString().slice(0, 10);
    send(res, await attendanceService.dailySummary(schoolId(req), date));
  },
  async absentees(req: Request, res: Response) {
    const date = typeof req.query.date === 'string' ? req.query.date : new Date().toISOString().slice(0, 10);
    send(res, await attendanceService.absentees(schoolId(req), date));
  },
  async monthlyReport(req: Request, res: Response) {
    const { classKey, month } = req.query as Record<string, string>;
    send(res, await attendanceService.monthlyReport(schoolId(req), { classKey, month }));
  },
  async lowAttendance(req: Request, res: Response) {
    const threshold = Number(req.query.threshold ?? 75);
    send(res, await attendanceService.lowAttendance(schoolId(req), threshold, req.query.classKey ? String(req.query.classKey) : undefined));
  },
  async registerMatrix(req: Request, res: Response) {
    const { classKey, month } = req.query as Record<string, string>;
    send(res, await attendanceService.registerMatrix(schoolId(req), { classKey, month }));
  },

  // Served under /students/:id/attendance
  async studentMonth(req: Request, res: Response) {
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    send(res, await attendanceService.studentMonth(schoolId(req), String(req.params.id), year, month));
  },
  async studentAnnual(req: Request, res: Response) {
    send(res, await attendanceService.studentAnnual(schoolId(req), String(req.params.id)));
  },
};
