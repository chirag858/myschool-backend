import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { assignedClassesOf } from '../coordinator/coordinator.service';
import { examService } from './exams.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
const p = (req: Request, key: string): string => String(req.params[key]);
const actor = (req: Request): string => String(req.user?.role ?? 'System');

/** A coordinator with a non-empty assignedClasses may only schedule exams
 * for their own supervised classes — empty means unscoped (whole school). */
async function assertCoordinatorExamClasses(req: Request, classes: unknown): Promise<void> {
  if (req.user?.role !== 'coordinator') return;
  const allowed = await assignedClassesOf(String(req.user._id));
  if (!allowed.length) return;
  const requested = Array.isArray(classes) ? (classes as string[]) : [];
  if (requested.some((c) => !allowed.includes(c))) {
    throw ApiError.forbidden('You can only schedule exams for your assigned classes');
  }
}

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
    await assertCoordinatorExamClasses(req, (req.body as { classes?: unknown }).classes);
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
  async saveDateSheet(req: Request, res: Response) {
    send(res, await examService.saveDateSheet(schoolId(req), p(req, 'id'), req.body.dateSheet));
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

  async analytics(req: Request, res: Response) {
    const { classKey } = req.query as Record<string, string>;
    send(res, await examService.analytics(schoolId(req), p(req, 'id'), classKey));
  },
  async reportCard(req: Request, res: Response) {
    send(res, await examService.reportCard(schoolId(req), p(req, 'id'), p(req, 'studentId')));
  },
  async bulkReportCards(req: Request, res: Response) {
    const { classKey } = req.query as Record<string, string>;
    send(res, await examService.bulkReportCards(schoolId(req), p(req, 'id'), classKey));
  },
  async updateRemarks(req: Request, res: Response) {
    send(res, await examService.updateRemarks(schoolId(req), p(req, 'id'), p(req, 'studentId'), req.body));
  },

  // Served under /students/:id/exams
  async studentExams(req: Request, res: Response) {
    send(res, await examService.studentExams(schoolId(req), p(req, 'id')));
  },

  // ── ID cards ──
  async studentIdSelections(req: Request, res: Response) {
    send(res, await examService.studentIdSelections(schoolId(req)));
  },
  async staffIdSelections(req: Request, res: Response) {
    send(res, await examService.staffIdSelections(schoolId(req)));
  },
  async logIdCards(req: Request, res: Response) {
    const { kind, ids } = req.body as { kind: 'student' | 'staff'; ids: string[] };
    send(res, await examService.logIdCardGeneration(schoolId(req), kind, ids));
  },
};
