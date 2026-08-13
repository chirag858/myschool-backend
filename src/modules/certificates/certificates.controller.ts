import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { UserModel } from '../user/user.model';
import { certificatesService } from './certificates.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}

async function actorName(req: Request): Promise<string> {
  const u = await UserModel.findById(req.user?._id).lean();
  return (u?.name as string) ?? 'System';
}

export const certificatesController = {
  async getHistory(req: Request, res: Response) {
    send(res, await certificatesService.getHistory(schoolId(req)));
  },
  async generateTCNumber(req: Request, res: Response) {
    send(res, { tcNumber: await certificatesService.generateTCNumber(schoolId(req)) });
  },
  async generate(req: Request, res: Response) {
    created(res, await certificatesService.generate(schoolId(req), await actorName(req), req.body));
  },
  async markStudentTCIssued(req: Request, res: Response) {
    send(res, await certificatesService.markStudentTCIssued(schoolId(req), String(req.params.id)));
  },
};
