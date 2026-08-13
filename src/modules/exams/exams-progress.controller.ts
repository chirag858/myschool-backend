import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { send } from '../../lib/api-response';
import { examsProgressService } from './exams-progress.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
const p = (req: Request, key: string): string => String(req.params[key]);

export const examsProgressController = {
  async getClassMarksProgress(req: Request, res: Response) {
    send(res, await examsProgressService.getClassMarksProgress(schoolId(req), p(req, 'id')));
  },
  async getSubjectMarksStatus(req: Request, res: Response) {
    const { classKey } = req.query as Record<string, string>;
    send(res, await examsProgressService.getSubjectMarksStatus(schoolId(req), p(req, 'id'), classKey));
  },
  async getAuditLog(req: Request, res: Response) {
    send(res, await examsProgressService.getAuditLog(schoolId(req), p(req, 'id')));
  },
};
