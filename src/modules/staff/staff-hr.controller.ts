import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { staffHrService } from './staff-hr.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
const p = (req: Request, key: string): string => String(req.params[key]);

export const staffHrController = {
  // Leave
  async leaveBalance(req: Request, res: Response) {
    send(res, await staffHrService.getLeaveBalance(schoolId(req), p(req, 'id')));
  },
  async leaveHistory(req: Request, res: Response) {
    send(res, await staffHrService.getLeaveHistory(schoolId(req), p(req, 'id')));
  },
  async applyLeave(req: Request, res: Response) {
    created(res, await staffHrService.applyLeave(schoolId(req), p(req, 'id'), req.body));
  },
  async reviewLeave(req: Request, res: Response) {
    const { action, remarks } = req.body as { action: 'approve' | 'reject'; remarks?: string };
    send(res, await staffHrService.reviewLeave(schoolId(req), p(req, 'leaveId'), action, remarks ?? ''));
  },

  // Salary
  async reviseSalary(req: Request, res: Response) {
    const { newBasic, reason } = req.body as { newBasic: number; reason: string };
    send(res, await staffHrService.reviseSalary(schoolId(req), p(req, 'id'), { newBasic, reason }));
  },
  async saveSalaryStructure(req: Request, res: Response) {
    await staffHrService.saveSalaryStructure(schoolId(req), p(req, 'id'), req.body);
    res.status(204).end();
  },
  async payrollHistory(req: Request, res: Response) {
    send(res, await staffHrService.getStaffPayrollHistory(schoolId(req), p(req, 'id')));
  },

  // Documents
  async getDocuments(req: Request, res: Response) {
    send(res, await staffHrService.getStaffDocuments(schoolId(req), p(req, 'id')));
  },
  async uploadDocument(req: Request, res: Response) {
    created(res, await staffHrService.uploadDocument(schoolId(req), p(req, 'id'), req.body));
  },
  async generateDocument(req: Request, res: Response) {
    created(res, await staffHrService.generateHRDocument(schoolId(req), req.body));
  },

  // Activity + notice period
  async activityLog(req: Request, res: Response) {
    send(res, await staffHrService.getStaffActivity(schoolId(req), p(req, 'id')));
  },
  async noticePeriod(req: Request, res: Response) {
    send(res, staffHrService.calculateNoticePeriod(p(req, 'employmentType')));
  },

  // Exit
  async submitExit(req: Request, res: Response) {
    created(res, await staffHrService.submitExit(schoolId(req), p(req, 'id'), req.body));
  },
  async exitRecord(req: Request, res: Response) {
    send(res, await staffHrService.getExitRecord(schoolId(req), p(req, 'id')));
  },

  // Payroll (org level)
  async payrollKpi(req: Request, res: Response) {
    send(res, await staffHrService.getPayrollKpi(schoolId(req)));
  },
  async getPayroll(req: Request, res: Response) {
    send(res, await staffHrService.getPayroll(schoolId(req), String(req.query.month ?? ''), Number(req.query.year ?? 0)));
  },
  async generatePayroll(req: Request, res: Response) {
    const { month, year } = req.body as { month: string; year: number };
    created(res, await staffHrService.generatePayroll(schoolId(req), month, Number(year)));
  },
  async markPaid(req: Request, res: Response) {
    send(res, await staffHrService.markPaid(schoolId(req), p(req, 'slipId'), req.body));
  },
  async putOnHold(req: Request, res: Response) {
    const { reason } = req.body as { reason: string };
    send(res, await staffHrService.putOnHold(schoolId(req), p(req, 'slipId'), reason));
  },

  // Advances
  async advanceRequests(req: Request, res: Response) {
    send(res, await staffHrService.getAdvanceRequests(schoolId(req)));
  },
  async createAdvance(req: Request, res: Response) {
    created(res, await staffHrService.createAdvanceRequest(schoolId(req), req.body));
  },
  async reviewAdvance(req: Request, res: Response) {
    const { action } = req.body as { action: 'approve' | 'reject' };
    send(res, await staffHrService.reviewAdvanceRequest(schoolId(req), p(req, 'id'), action));
  },
  async activeAdvances(req: Request, res: Response) {
    send(res, await staffHrService.getActiveAdvances(schoolId(req)));
  },
};
