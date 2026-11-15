import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { uploadToR2 } from '../../lib/storage';
import { syllabusService } from './syllabus.service';

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
const q = (req: Request, key: string): string | undefined => {
  const v = req.query[key];
  return v == null ? undefined : String(v);
};

export const syllabusController = {
  async list(req: Request, res: Response) {
    send(res, await syllabusService.list(schoolId(req), q(req, 'classKey')));
  },
  async create(req: Request, res: Response) {
    created(res, await syllabusService.create(schoolId(req), uid(req), req.body));
  },
  async update(req: Request, res: Response) {
    send(res, await syllabusService.update(schoolId(req), p(req, 'id'), req.body));
  },
  async remove(req: Request, res: Response) {
    await syllabusService.remove(schoolId(req), p(req, 'id'));
    res.status(204).end();
  },
  /** Upload the syllabus file to R2 and return its URL; client then POSTs the
   *  metadata + URL to create the row. Mirrors the teacher attachment flow. */
  async uploadFile(req: MulterRequest, res: Response) {
    if (!req.file) throw ApiError.badRequest('No file uploaded');
    const { url, key } = await uploadToR2({
      schoolId: schoolId(req),
      folder: 'syllabus',
      fileName: req.file.originalname,
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
    });
    send(res, { url, key, fileName: req.file.originalname });
  },
};
