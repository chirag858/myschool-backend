import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { picnicService } from './picnic.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
function userId(req: Request): string {
  const id = req.user?._id;
  if (!id) throw ApiError.unauthorized();
  return id;
}
function role(req: Request): string {
  return req.user?.role ?? '';
}
const p = (req: Request, key: string): string => String(req.params[key]);

export const picnicController = {
  async getAssignedClasses(req: Request, res: Response) {
    send(res, await picnicService.getAssignedClasses(schoolId(req), userId(req)));
  },
  async getStudentsForClasses(req: Request, res: Response) {
    const classKeys = String(req.query.classKeys ?? '').split(',').filter(Boolean);
    send(res, await picnicService.getStudentsForClasses(schoolId(req), userId(req), classKeys));
  },
  async listMine(req: Request, res: Response) {
    send(res, await picnicService.listMine(schoolId(req), userId(req), req.query as Record<string, string>));
  },
  async listRequests(req: Request, res: Response) {
    send(res, await picnicService.listRequests(schoolId(req), req.query as Record<string, string>));
  },
  async getDetail(req: Request, res: Response) {
    send(res, await picnicService.getDetail(schoolId(req), userId(req), role(req), p(req, 'id')));
  },
  async create(req: Request, res: Response) {
    created(res, await picnicService.create(schoolId(req), userId(req), req.body));
  },
  async update(req: Request, res: Response) {
    send(res, await picnicService.update(schoolId(req), userId(req), p(req, 'id'), req.body));
  },
  async submit(req: Request, res: Response) {
    send(res, await picnicService.submit(schoolId(req), userId(req), p(req, 'id')));
  },
  async decide(req: Request, res: Response) {
    const { status, reason } = req.body as { status: 'approved' | 'rejected'; reason?: string };
    send(res, await picnicService.decide(schoolId(req), userId(req), p(req, 'id'), status, reason));
  },
  async generatePasses(req: Request, res: Response) {
    created(res, await picnicService.generatePasses(schoolId(req), userId(req), p(req, 'id')));
  },
  async listPasses(req: Request, res: Response) {
    send(res, await picnicService.listPasses(schoolId(req), userId(req), role(req), p(req, 'id')));
  },
};
