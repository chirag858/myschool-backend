import type { Request, Response } from 'express';

import { created, noContent, send } from '../../lib/api-response';
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

  async getSetting(req: Request, res: Response) {
    send(res, await platformService.getSetting(String(req.params.type)));
  },
  async saveSetting(req: Request, res: Response) {
    send(res, await platformService.saveSetting(String(req.params.type), req.body));
  },

  async getWhatsAppTemplates(_req: Request, res: Response) {
    send(res, await platformService.getWhatsAppTemplates());
  },
  async addWhatsAppTemplate(req: Request, res: Response) {
    created(res, await platformService.addWhatsAppTemplate(req.body));
  },
  async deleteWhatsAppTemplate(req: Request, res: Response) {
    await platformService.deleteWhatsAppTemplate(String(req.params.id));
    noContent(res);
  },

  async getEmailTemplates(_req: Request, res: Response) {
    send(res, await platformService.getEmailTemplates());
  },
  async saveEmailTemplate(req: Request, res: Response) {
    send(res, await platformService.saveEmailTemplate(String(req.params.id), req.body));
  },
};
