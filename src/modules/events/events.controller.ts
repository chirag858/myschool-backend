import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { uploadToR2 } from '../../lib/storage';
import { eventsService } from './events.service';

interface MulterRequest extends Request {
  file?: Express.Multer.File;
}

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
const uid = (req: Request): string => String(req.user?._id);
const p = (req: Request, key: string): string => String(req.params[key]);

export const eventsController = {
  async list(req: Request, res: Response) {
    send(res, await eventsService.list(schoolId(req)));
  },
  async getById(req: Request, res: Response) {
    send(res, await eventsService.getById(schoolId(req), p(req, 'id')));
  },
  async create(req: Request, res: Response) {
    created(res, await eventsService.create(schoolId(req), uid(req), req.body));
  },
  async update(req: Request, res: Response) {
    send(res, await eventsService.update(schoolId(req), p(req, 'id'), req.body));
  },
  async addPhoto(req: Request, res: Response) {
    send(res, await eventsService.addPhoto(schoolId(req), p(req, 'id'), req.body));
  },
  async removePhoto(req: Request, res: Response) {
    send(res, await eventsService.removePhoto(schoolId(req), p(req, 'id'), p(req, 'photoId')));
  },
  async remove(req: Request, res: Response) {
    await eventsService.remove(schoolId(req), p(req, 'id'));
    res.status(204).end();
  },
  /** Upload one image to R2 and return its URL; the client then POSTs it to
   *  /:id/photos. Mirrors the teacher homework-attachment upload flow. */
  async uploadPhoto(req: MulterRequest, res: Response) {
    if (!req.file) throw ApiError.badRequest('No file uploaded');
    const { url, key } = await uploadToR2({
      schoolId: schoolId(req),
      folder: 'event-photos',
      fileName: req.file.originalname,
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
    });
    send(res, { url, key });
  },
};
