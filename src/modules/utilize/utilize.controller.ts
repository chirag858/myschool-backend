import type { Request, Response } from 'express';

import { send, created } from '../../lib/api-response';
import { sendExcel, sendPdf } from '../reports/reports.export';
import { UserModel } from '../user/user.model';
import { utilizeService } from './utilize.service';

/** super_admin gets cross-tenant scope; everyone else is scoped to their own school. */
function schoolId(req: Request): string | undefined {
  return req.user?.role === 'super_admin' ? undefined : req.user?.schoolId;
}
async function actor(req: Request): Promise<{ name: string; role: string; ip: string }> {
  const u = await UserModel.findById(req.user?._id).lean();
  return { name: (u?.name as string) ?? 'System', role: req.user?.role ?? '', ip: req.ip ?? '' };
}
function q(req: Request, key: string): string | undefined {
  const v = req.query[key];
  return v == null ? undefined : String(v);
}

export const utilizeController = {
  async searchReceipts(req: Request, res: Response) {
    send(res, await utilizeService.searchReceipts(schoolId(req), q(req, 'q') ?? ''));
  },
  async searchStudents(req: Request, res: Response) {
    send(res, await utilizeService.searchStudents(schoolId(req), q(req, 'q') ?? ''));
  },
  async getDuplicates(req: Request, res: Response) {
    send(res, await utilizeService.getDuplicates(schoolId(req)));
  },
  async submitCorrection(req: Request, res: Response) {
    created(res, await utilizeService.submitCorrection(schoolId(req), await actor(req), req.body));
  },
  async getApprovalQueue(req: Request, res: Response) {
    send(res, await utilizeService.getApprovalQueue(schoolId(req), q(req, 'status')));
  },
  async approveCorrection(req: Request, res: Response) {
    const { remarks } = req.body as { remarks?: string };
    send(res, await utilizeService.approveCorrection(schoolId(req), String(req.params.id), remarks ?? '', await actor(req)));
  },
  async rejectCorrection(req: Request, res: Response) {
    const { reason } = req.body as { reason: string };
    send(res, await utilizeService.rejectCorrection(schoolId(req), String(req.params.id), reason));
  },
  async getAuditLog(req: Request, res: Response) {
    send(
      res,
      await utilizeService.getAuditLog(schoolId(req), {
        type: q(req, 'type'),
        operator: q(req, 'operator'),
        student: q(req, 'student'),
        status: q(req, 'status'),
        dateFrom: q(req, 'dateFrom'),
        dateTo: q(req, 'dateTo'),
      }),
    );
  },
  async exportAuditLog(req: Request, res: Response) {
    const format = String(req.query.format);
    const report = await utilizeService.exportAuditLog(schoolId(req), {
      type: q(req, 'type'),
      operator: q(req, 'operator'),
      student: q(req, 'student'),
      status: q(req, 'status'),
      dateFrom: q(req, 'dateFrom'),
      dateTo: q(req, 'dateTo'),
    });
    const fileName = `correction-audit-log-${Date.now()}`;
    if (format === 'excel') {
      await sendExcel(res, report, fileName);
    } else {
      sendPdf(res, report, fileName);
    }
  },
};
