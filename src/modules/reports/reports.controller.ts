import type { Request, Response } from 'express';

import { send } from '../../lib/api-response';
import { sendExcel, sendPdf } from './reports.export';
import { reportsService } from './reports.service';

export const reportsController = {
  async getReport(req: Request, res: Response) {
    send(res, await reportsService.getReport(String(req.params.key)));
  },

  async exportReport(req: Request, res: Response) {
    const key = String(req.params.key);
    const format = String(req.query.format);
    const report = await reportsService.getReport(key);
    if (format === 'excel') {
      await sendExcel(res, report, key);
    } else {
      sendPdf(res, report, key);
    }
  },
};
