import type { Request, Response } from 'express';

import { send } from '../../lib/api-response';
import { sendExcel, sendPdf } from './reports.export';
import { schoolReportsService } from './school-reports.service';

export const schoolReportsController = {
  async getReport(req: Request, res: Response) {
    send(res, await schoolReportsService.getReport(String(req.params.schoolId), String(req.params.key)));
  },

  async exportReport(req: Request, res: Response) {
    const schoolId = String(req.params.schoolId);
    const key = String(req.params.key);
    const format = String(req.query.format);
    const report = await schoolReportsService.getReport(schoolId, key);
    const fileName = `${key}-${schoolId}`;
    if (format === 'excel') {
      await sendExcel(res, report, fileName);
    } else {
      sendPdf(res, report, fileName);
    }
  },
};
