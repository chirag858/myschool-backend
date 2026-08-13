import type { Request, Response } from 'express';
import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { enquiryService } from './enquiry.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}

export const enquiryController = {
  async list(req: Request, res: Response) {
    send(res, await enquiryService.list(schoolId(req)));
  },

  async create(req: Request, res: Response) {
    created(res, await enquiryService.create(schoolId(req), req.body));
  },

  async updateStatus(req: Request, res: Response) {
    const { status } = req.body as { status: string };
    send(res, await enquiryService.updateStatus(schoolId(req), String(req.params.id), status));
  },

  async delete(req: Request, res: Response) {
    await enquiryService.delete(schoolId(req), String(req.params.id));
    res.status(204).end();
  },

  async convert(req: Request, res: Response) {
    send(res, await enquiryService.convert(schoolId(req), String(req.params.id)));
  },
};
