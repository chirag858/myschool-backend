import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { classService, holidayService, sessionService } from './academics.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
const p = (req: Request, key: string): string => String(req.params[key]);

export const sessionController = {
  async list(req: Request, res: Response) {
    send(res, await sessionService.list(schoolId(req)));
  },
  async stats(req: Request, res: Response) {
    send(res, await sessionService.stats(schoolId(req), p(req, 'id')));
  },
  async create(req: Request, res: Response) {
    created(res, await sessionService.create(schoolId(req), req.body, 'Admin'));
  },
  async activate(req: Request, res: Response) {
    send(res, await sessionService.activate(schoolId(req), p(req, 'id')));
  },
  async close(req: Request, res: Response) {
    send(res, await sessionService.close(schoolId(req), p(req, 'id')));
  },
  async archive(req: Request, res: Response) {
    send(res, await sessionService.archive(schoolId(req), p(req, 'id')));
  },
};

export const classController = {
  async list(req: Request, res: Response) {
    send(res, await classService.list(schoolId(req)));
  },
  async create(req: Request, res: Response) {
    created(res, await classService.create(schoolId(req), req.body));
  },
  async update(req: Request, res: Response) {
    send(res, await classService.update(schoolId(req), p(req, 'id'), req.body));
  },
  async remove(req: Request, res: Response) {
    send(res, await classService.remove(schoolId(req), p(req, 'id')));
  },
  async reorder(req: Request, res: Response) {
    send(res, await classService.reorder(schoolId(req), req.body as string[]));
  },
  async listSections(req: Request, res: Response) {
    send(res, await classService.listSections(schoolId(req), p(req, 'classId')));
  },
  async createSection(req: Request, res: Response) {
    created(res, await classService.createSection(schoolId(req), p(req, 'classId'), req.body));
  },
  async updateSection(req: Request, res: Response) {
    send(res, await classService.updateSection(schoolId(req), p(req, 'classId'), p(req, 'sectionId'), req.body));
  },
  async deleteSection(req: Request, res: Response) {
    send(res, await classService.deleteSection(schoolId(req), p(req, 'classId'), p(req, 'sectionId')));
  },
};

export const holidayController = {
  async list(req: Request, res: Response) {
    const session = typeof req.query.session === 'string' ? req.query.session : undefined;
    send(res, await holidayService.list(schoolId(req), session));
  },
  async create(req: Request, res: Response) {
    created(res, await holidayService.create(schoolId(req), req.body));
  },
  async update(req: Request, res: Response) {
    send(res, await holidayService.update(schoolId(req), p(req, 'id'), req.body));
  },
  async remove(req: Request, res: Response) {
    send(res, await holidayService.remove(schoolId(req), p(req, 'id')));
  },
  async copyFromSession(req: Request, res: Response) {
    send(res, await holidayService.copyFromSession(schoolId(req)));
  },
  async workingDaysSummary(req: Request, res: Response) {
    send(res, await holidayService.workingDaysSummary(schoolId(req)));
  },
};
