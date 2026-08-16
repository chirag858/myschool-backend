import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { noContent, send } from '../../lib/api-response';
import { uploadToR2 } from '../../lib/storage';
import { MODULE_KEYS } from './school.model';
import { schoolService } from './school.service';

interface MulterRequest extends Request {
  file?: Express.Multer.File;
}

export const schoolController = {
  async dashboardStats(_req: Request, res: Response) {
    send(res, await schoolService.getDashboardStats());
  },

  /** Branding asset (logo/signature/stamp) upload during school creation —
   * runs before the school document exists, so objects are keyed under a
   * flat `platform` prefix rather than a schoolId. */
  async uploadAsset(req: MulterRequest, res: Response) {
    if (!req.file) throw ApiError.badRequest('No file uploaded (expected field "asset")');
    const { url } = await uploadToR2({
      schoolId: 'platform',
      folder: 'school-branding',
      fileName: req.file.originalname,
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
    });
    send(res, { url });
  },

  async list(req: Request, res: Response) {
    send(res, await schoolService.getSchools(req.query));
  },

  async generateCode(req: Request, res: Response) {
    send(res, await schoolService.generateSchoolCode(String(req.query.name ?? '')));
  },

  async checkCode(req: Request, res: Response) {
    send(res, await schoolService.checkSchoolCode(String(req.query.code ?? '')));
  },

  async listLite(_req: Request, res: Response) {
    send(res, await schoolService.getSchoolList());
  },

  async detail(req: Request, res: Response) {
    send(res, await schoolService.getSchoolDetail(String(req.params.id)));
  },

  async create(req: Request, res: Response) {
    send(res, await schoolService.createSchool(req.body), 201);
  },

  async setStatus(req: Request, res: Response) {
    const { status, reason } = req.body as { status: string; reason?: string };
    send(res, await schoolService.setSchoolStatus(String(req.params.id), status, reason));
  },

  async activationOverview(_req: Request, res: Response) {
    send(res, await schoolService.getActivationOverview());
  },

  async remove(req: Request, res: Response) {
    await schoolService.deleteSchool(String(req.params.id));
    noContent(res);
  },

  async getModules(req: Request, res: Response) {
    send(res, await schoolService.getSchoolModules(String(req.params.id)));
  },

  async setModules(req: Request, res: Response) {
    // Keep only known module keys.
    const body = req.body as Record<string, boolean>;
    const filtered: Record<string, boolean> = {};
    for (const key of MODULE_KEYS) if (key in body) filtered[key] = Boolean(body[key]);
    send(res, await schoolService.setSchoolModules(String(req.params.id), filtered));
  },
};
