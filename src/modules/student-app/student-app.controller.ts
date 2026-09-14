import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { studentAppService } from './student-app.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
const userId = (req: Request): string => String(req.user?._id);

export const studentAppController = {
  async me(req: Request, res: Response) {
    send(res, await studentAppService.me(schoolId(req), userId(req)));
  },
  async summary(req: Request, res: Response) {
    send(res, await studentAppService.dashboardSummary(schoolId(req), userId(req)));
  },
  async idCard(req: Request, res: Response) {
    send(res, await studentAppService.idCard(schoolId(req), userId(req)));
  },
  async library(req: Request, res: Response) {
    send(res, await studentAppService.library(schoolId(req), userId(req)));
  },
  async notices(req: Request, res: Response) {
    send(res, await studentAppService.notices(schoolId(req), userId(req)));
  },
  async markNoticeRead(req: Request, res: Response) {
    await studentAppService.markNoticeRead(schoolId(req), userId(req), String(req.body.id));
    send(res, { success: true });
  },
  async markAllNoticesRead(req: Request, res: Response) {
    await studentAppService.markAllNoticesRead(schoolId(req), userId(req));
    send(res, { success: true });
  },
  async assignments(req: Request, res: Response) {
    send(res, await studentAppService.assignments(schoolId(req), userId(req)));
  },
  async submit(req: Request, res: Response) {
    created(res, await studentAppService.submit(schoolId(req), userId(req), req.body));
  },
};
