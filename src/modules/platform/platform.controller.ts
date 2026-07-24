import type { Request, Response } from 'express';

import { send } from '../../lib/api-response';
import { platformService } from './platform.service';

export const platformController = {
  async modulesOverview(_req: Request, res: Response) {
    send(res, await platformService.getModulesOverview());
  },
  async setModule(req: Request, res: Response) {
    const { enabled } = req.body as { enabled: boolean };
    send(res, await platformService.setModuleEnabled(String(req.params.key), enabled));
  },
  async appsOverview(_req: Request, res: Response) {
    send(res, await platformService.getAppsOverview());
  },
  async setApp(req: Request, res: Response) {
    const { enabled } = req.body as { enabled: boolean };
    send(res, await platformService.setAppEnabled(String(req.params.key), enabled));
  },
  async roleUserCounts(_req: Request, res: Response) {
    send(res, await platformService.getRoleUserCounts());
  },
};
