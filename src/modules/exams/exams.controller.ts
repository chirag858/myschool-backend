import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { examService } from './exams.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
const p = (req: Request, key: string): string => String(req.params[key]);
const actor = (req: Request): string => String(req.user?.role ?? 'System');

export const examController = {
  async list(req: Request, res: Response) {
    send(res, await examService.list(schoolId(req)));
  },
  async kpi(req: Request, res: Response) {
    send(res, await examService.kpi(schoolId(req)));
  },
  async upcoming(req: Request, res: Response) {
    send(res, await examService.upcoming(schoolId(req)));
  },
  async get(req: Request, res: Response) {
    send(res, await examService.get(schoolId(req), p(req, 'id')));
  },
  async create(req: Request, res: Response) {
    created(res, await examService.create(schoolId(req), req.body));
  },
  async publish(req: Request, res: Response) {
    send(res, await examService.publish(schoolId(req), p(req, 'id')));
  },
  async unpublish(req: Request, res: Response) {
    send(res, await examService.unpublish(schoolId(req), p(req, 'id')));
  },
  async remove(req: Request, res: Response) {
    send(res, await examService.remove(schoolId(req), p(req, 'id')));
  },

  async getMarks(req: Request, res: Response) {
    const { classKey, subjectId } = req.query as Record<string, string>;
    send(res, await examService.getMarks(schoolId(req), p(req, 'id'), classKey, subjectId));
  },
  async saveDraft(req: Request, res: Response) {
    const { classKey, subjectId, rows } = req.body;
    send(res, await examService.saveMarks(schoolId(req), p(req, 'id'), classKey, subjectId, rows, false, actor(req)));
  },
  async submit(req: Request, res: Response) {
    const { classKey, subjectId, rows } = req.body;
    send(res, await examService.saveMarks(schoolId(req), p(req, 'id'), classKey, subjectId, rows, true, actor(req)));
  },

  async calculate(req: Request, res: Response) {
    const { classKey } = req.body as { classKey: string };
    send(res, await examService.results(schoolId(req), p(req, 'id'), classKey));
  },
  async results(req: Request, res: Response) {
    const { classKey } = req.query as Record<string, string>;
    send(res, await examService.results(schoolId(req), p(req, 'id'), classKey));
  },
  async publishResults(req: Request, res: Response) {
    const { classKey } = req.body as { classKey: string };
    send(res, await examService.publishResults(schoolId(req), p(req, 'id'), classKey));
  },
  async unpublishResults(req: Request, res: Response) {
    const { classKey } = req.body as { classKey: string };
    send(res, await examService.unpublishResults(schoolId(req), p(req, 'id'), classKey));
  },

  // Served under /students/:id/exams
  async studentExams(req: Request, res: Response) {
    send(res, await examService.studentExams(schoolId(req), p(req, 'id')));
  },
};
