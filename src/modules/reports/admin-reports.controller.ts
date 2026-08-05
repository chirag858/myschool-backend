import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { send } from '../../lib/api-response';
import { customReportService, type CustomReportConfig } from './custom-report.service';
import { sendExcel, sendPdf } from './reports.export';
import { schoolReportsService } from './school-reports.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}

/** School-scoped mirror of the super-admin school-reports API — the requesting user's own school, no schoolId param. */
export const adminReportsController = {
  async getReport(req: Request, res: Response) {
    send(res, await schoolReportsService.getReport(schoolId(req), String(req.params.key)));
  },

  async exportReport(req: Request, res: Response) {
    const key = String(req.params.key);
    const format = String(req.query.format);
    const report = await schoolReportsService.getReport(schoolId(req), key);
    const fileName = `${key}-report`;
    if (format === 'excel') {
      await sendExcel(res, report, fileName);
    } else {
      sendPdf(res, report, fileName);
    }
  },

  async runCustom(req: Request, res: Response) {
    send(res, await customReportService.run(schoolId(req), req.body as CustomReportConfig));
  },

  async exportCustom(req: Request, res: Response) {
    const format = String(req.query.format);
    const report = await customReportService.run(schoolId(req), req.body as CustomReportConfig);
    const fileName = `custom-report-${Date.now()}`;
    if (format === 'excel') {
      await sendExcel(res, report, fileName);
    } else {
      sendPdf(res, report, fileName);
    }
  },
};
