import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { sendExcel } from '../reports/reports.export';
import { coordinatorService } from './coordinator.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
function userId(req: Request): string {
  const id = req.user?._id;
  if (!id) throw ApiError.unauthorized();
  return id;
}
const p = (req: Request, key: string): string => String(req.params[key]);

export const coordinatorController = {
  async dashboard(req: Request, res: Response) {
    send(res, await coordinatorService.dashboard(schoolId(req), userId(req)));
  },
  async getStudents(req: Request, res: Response) {
    send(
      res,
      await coordinatorService.getStudents(schoolId(req), userId(req), req.query as Record<string, string>),
    );
  },
  async setAssignedClasses(req: Request, res: Response) {
    const { classKeys } = req.body as { classKeys: string[] };
    send(res, await coordinatorService.setAssignedClasses(schoolId(req), p(req, 'userId'), classKeys));
  },
  async getStudentLeaves(req: Request, res: Response) {
    send(res, await coordinatorService.getStudentLeaves(schoolId(req), req.query as Record<string, string>));
  },
  async applyOnBehalf(req: Request, res: Response) {
    created(res, await coordinatorService.applyOnBehalf(schoolId(req), req.body));
  },
  async approve(req: Request, res: Response) {
    const { remarks } = req.body as { remarks?: string };
    send(res, await coordinatorService.approve(schoolId(req), p(req, 'id'), remarks));
  },
  async reject(req: Request, res: Response) {
    const { reason } = req.body as { reason: string };
    send(res, await coordinatorService.reject(schoolId(req), p(req, 'id'), reason));
  },
  async forward(req: Request, res: Response) {
    const { remarks } = req.body as { remarks?: string };
    send(res, await coordinatorService.forward(schoolId(req), p(req, 'id'), remarks));
  },

  async getStaffLeaves(req: Request, res: Response) {
    send(res, await coordinatorService.getStaffLeaves(schoolId(req), req.query.tab ? String(req.query.tab) : undefined));
  },
  async approveStaffLeaveLevel1(req: Request, res: Response) {
    const { remarks } = req.body as { remarks?: string };
    send(res, await coordinatorService.approveStaffLeaveLevel1(schoolId(req), p(req, 'id'), remarks));
  },
  async rejectStaffLeave(req: Request, res: Response) {
    const { reason } = req.body as { reason: string };
    send(res, await coordinatorService.rejectStaffLeave(schoolId(req), p(req, 'id'), reason));
  },
  async getMarksOverview(req: Request, res: Response) {
    send(res, await coordinatorService.getMarksOverview(schoolId(req), String(req.query.examId ?? '')));
  },
  async getStaffOverview(req: Request, res: Response) {
    send(res, await coordinatorService.getStaffOverview(schoolId(req), req.query.department ? String(req.query.department) : undefined));
  },
  async getStaffAttendance(req: Request, res: Response) {
    send(res, await coordinatorService.getStaffAttendance(schoolId(req), req.query.department ? String(req.query.department) : undefined));
  },

  async exportStudents(req: Request, res: Response) {
    const report = await coordinatorService.exportStudentsReport(schoolId(req), userId(req), req.query as Record<string, string>);
    await sendExcel(res, report, 'coordinator-students');
  },
  async exportStaffAttendance(req: Request, res: Response) {
    const report = await coordinatorService.exportStaffAttendanceReport(
      schoolId(req),
      req.query.department ? String(req.query.department) : undefined,
    );
    await sendExcel(res, report, 'coordinator-staff-attendance');
  },
  async messageStaff(req: Request, res: Response) {
    const { body } = req.body as { body: string };
    created(res, await coordinatorService.messageStaff(schoolId(req), p(req, 'staffId'), body));
  },
};
