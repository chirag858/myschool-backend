import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { uploadToR2 } from '../../lib/storage';
import { gateManagerService } from './gate-manager.service';

interface MulterRequest extends Request {
  file?: Express.Multer.File;
}

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
const userId = (req: Request): string => String(req.user?._id);
const p = (req: Request, key: string): string => String(req.params[key]);

export const gateManagerController = {
  async uploadPhoto(req: MulterRequest, res: Response) {
    if (!req.file) throw ApiError.badRequest('No file uploaded (expected field "photo")');
    const { url } = await uploadToR2({
      schoolId: schoolId(req),
      folder: 'gate-photos',
      fileName: req.file.originalname,
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
    });
    send(res, { url });
  },
  async dashboard(req: Request, res: Response) {
    send(res, await gateManagerService.dashboard(schoolId(req)));
  },
  async searchStudents(req: Request, res: Response) {
    send(res, await gateManagerService.searchStudents(schoolId(req), String(req.query.q ?? '')));
  },
  async getPickups(req: Request, res: Response) {
    send(res, await gateManagerService.getPickups(schoolId(req)));
  },
  async releaseStudent(req: Request, res: Response) {
    created(res, await gateManagerService.releaseStudent(schoolId(req), userId(req), req.body));
  },
  async sendOtp(req: Request, res: Response) {
    send(res, gateManagerService.sendOtp(String(req.body.mobile)));
  },
  async getVisitors(req: Request, res: Response) {
    send(res, await gateManagerService.getVisitors(schoolId(req)));
  },
  async logVisitor(req: Request, res: Response) {
    created(res, await gateManagerService.logVisitor(schoolId(req), req.body));
  },
  async checkoutVisitor(req: Request, res: Response) {
    send(res, await gateManagerService.checkoutVisitor(schoolId(req), p(req, 'id')));
  },
  async getTeacherPasses(req: Request, res: Response) {
    send(res, await gateManagerService.getTeacherPasses(schoolId(req)));
  },
  async logTeacherPass(req: Request, res: Response) {
    created(res, await gateManagerService.logTeacherPass(schoolId(req), userId(req), req.body));
  },
  async returnTeacherPass(req: Request, res: Response) {
    send(res, await gateManagerService.returnTeacherPass(schoolId(req), p(req, 'id')));
  },
};
