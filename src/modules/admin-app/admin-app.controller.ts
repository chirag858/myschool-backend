import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { send } from '../../lib/api-response';
import { UserModel } from '../user/user.model';
import { adminAppService } from './admin-app.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
async function actor(req: Request): Promise<{ name: string; role: string }> {
  const u = await UserModel.findById(req.user?._id).lean();
  return { name: (u?.name as string) ?? 'Manager', role: String(req.user?.role ?? 'manager') };
}
const q = (req: Request, k: string): string | undefined => (req.query[k] == null ? undefined : String(req.query[k]));

export const adminAppController = {
  async dashboard(req: Request, res: Response) {
    send(res, await adminAppService.dashboard(schoolId(req)));
  },
  async feeSummary(req: Request, res: Response) {
    send(res, await adminAppService.feeSummary(schoolId(req)));
  },
  async attendanceSummary(req: Request, res: Response) {
    send(res, await adminAppService.attendanceSummary(schoolId(req)));
  },
  async reports(req: Request, res: Response) {
    send(res, await adminAppService.reports(schoolId(req)));
  },
  async approvals(req: Request, res: Response) {
    send(res, await adminAppService.approvals(schoolId(req), q(req, 'type')));
  },
  async approvalDetail(req: Request, res: Response) {
    send(res, await adminAppService.approvalDetail(schoolId(req), String(req.query.id)));
  },
  async act(req: Request, res: Response) {
    const { id, action, reason, expectedLevel } = req.body as {
      id: string;
      action: 'endorse' | 'authorize' | 'reject';
      reason: string;
      expectedLevel: number;
    };
    send(res, await adminAppService.act(schoolId(req), id, action, reason, expectedLevel, await actor(req)));
  },
};
