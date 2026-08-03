import type { Request, Response } from 'express';

import { getInchargeSection } from '../academics/academics.service';
import { ApiError } from '../../lib/api-error';
import { send } from '../../lib/api-response';
import { attendanceService } from './attendance.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
const actor = (req: Request): string => String(req.user?.role ?? 'admin');

/** A `teacher` may only mark/override attendance for the one class they're
 * incharge of — every other role (admin/principal/coordinator/...) is
 * unrestricted. Called with the resolved `classKey` for the request. */
async function assertCanMark(req: Request, classKey: string): Promise<void> {
  if (req.user?.role !== 'teacher') return;
  const incharge = await getInchargeSection(schoolId(req), String(req.user._id));
  if (!incharge || incharge.classKey !== classKey) {
    throw ApiError.forbidden('You can only manage attendance for the class you are incharge of');
  }
}

/** Reports/dashboards must never let a teacher enumerate other classes'
 * attendance. For `teacher`, the returned `classKey` always overrides
 * whatever the client asked for (or is empty if they have no incharge class
 * yet, which returns zero rows rather than the whole school); every other
 * role passes through the client-supplied filter unrestricted. */
async function scopedClassKey(req: Request, requested?: string): Promise<string | undefined> {
  if (req.user?.role !== 'teacher') return requested;
  const incharge = await getInchargeSection(schoolId(req), String(req.user._id));
  return incharge?.classKey ?? '__none__';
}

export const attendanceController = {
  async markSession(req: Request, res: Response) {
    const { date, class: className, section } = req.query as Record<string, string>;
    await assertCanMark(req, `${className}-${section}`);
    send(res, await attendanceService.getMarkSession(schoolId(req), className, section, date));
  },
  async save(req: Request, res: Response) {
    await assertCanMark(req, String((req.body as { classKey?: string }).classKey ?? ''));
    send(res, await attendanceService.save(schoolId(req), req.body, actor(req)));
  },
  async saveAndAlert(req: Request, res: Response) {
    await assertCanMark(req, String((req.body as { classKey?: string }).classKey ?? ''));
    send(res, await attendanceService.saveAndAlert(schoolId(req), req.body, actor(req)));
  },
  async override(req: Request, res: Response) {
    await assertCanMark(req, String((req.body as { classKey?: string }).classKey ?? ''));
    send(res, await attendanceService.override(schoolId(req), req.body, actor(req)));
  },
  async overrideHistory(req: Request, res: Response) {
    const classKey = await scopedClassKey(req);
    const history = await attendanceService.overrideHistory(schoolId(req));
    send(res, classKey ? history.filter((h) => h.classLabel === classKey) : history);
  },
  async dashboard(req: Request, res: Response) {
    const date = typeof req.query.date === 'string' ? req.query.date : new Date().toISOString().slice(0, 10);
    const classKey = await scopedClassKey(req);
    send(res, await attendanceService.dashboard(schoolId(req), date, classKey));
  },
  async dailySummary(req: Request, res: Response) {
    const date = typeof req.query.date === 'string' ? req.query.date : new Date().toISOString().slice(0, 10);
    const classKey = await scopedClassKey(req);
    send(res, await attendanceService.dailySummary(schoolId(req), date, classKey));
  },
  async absentees(req: Request, res: Response) {
    const date = typeof req.query.date === 'string' ? req.query.date : new Date().toISOString().slice(0, 10);
    const classKey = await scopedClassKey(req);
    send(res, await attendanceService.absentees(schoolId(req), date, classKey));
  },
  async sendAbsenteeAlerts(req: Request, res: Response) {
    const { date, studentIds } = req.body as { date: string; studentIds?: string[] };
    send(res, await attendanceService.sendAbsenteeAlerts(schoolId(req), date, studentIds));
  },
  async monthlyReport(req: Request, res: Response) {
    const { month } = req.query as Record<string, string>;
    const classKey = await scopedClassKey(req, req.query.classKey ? String(req.query.classKey) : undefined);
    send(res, await attendanceService.monthlyReport(schoolId(req), { classKey, month }));
  },
  async lowAttendance(req: Request, res: Response) {
    const threshold = Number(req.query.threshold ?? 75);
    const classKey = await scopedClassKey(req, req.query.classKey ? String(req.query.classKey) : undefined);
    send(res, await attendanceService.lowAttendance(schoolId(req), threshold, classKey));
  },
  async registerMatrix(req: Request, res: Response) {
    const { month } = req.query as Record<string, string>;
    const classKey = await scopedClassKey(req, req.query.classKey ? String(req.query.classKey) : undefined);
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
