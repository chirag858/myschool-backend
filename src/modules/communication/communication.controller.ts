import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { communicationService } from './communication.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
const p = (req: Request, key: string): string => String(req.params[key]);
const q = (req: Request): Record<string, string> => req.query as Record<string, string>;

export const communicationController = {
  async kpi(req: Request, res: Response) {
    send(res, await communicationService.kpi(schoolId(req)));
  },

  // circulars
  async getCirculars(req: Request, res: Response) {
    send(res, await communicationService.getCirculars(schoolId(req), q(req)));
  },
  async upsertCircular(req: Request, res: Response) {
    created(res, await communicationService.upsertCircular(schoolId(req), req.body));
  },
  async publishCircular(req: Request, res: Response) {
    send(res, await communicationService.setCircularStatus(schoolId(req), p(req, 'id'), 'published'));
  },
  async archiveCircular(req: Request, res: Response) {
    send(res, await communicationService.setCircularStatus(schoolId(req), p(req, 'id'), 'archived'));
  },
  async deleteCircular(req: Request, res: Response) {
    send(res, await communicationService.deleteCircular(schoolId(req), p(req, 'id')));
  },

  // announcements
  async getAnnouncements(req: Request, res: Response) {
    send(res, await communicationService.getAnnouncements(schoolId(req)));
  },
  async upsertAnnouncement(req: Request, res: Response) {
    created(res, await communicationService.upsertAnnouncement(schoolId(req), req.body));
  },
  async deleteAnnouncement(req: Request, res: Response) {
    send(res, await communicationService.deleteAnnouncement(schoolId(req), p(req, 'id')));
  },

  // notifications
  async getNotifications(req: Request, res: Response) {
    send(res, await communicationService.getNotifications(schoolId(req), q(req)));
  },
  async markRead(req: Request, res: Response) {
    send(res, await communicationService.markRead(schoolId(req), p(req, 'id')));
  },
  async markAllRead(req: Request, res: Response) {
    send(res, await communicationService.markAllRead(schoolId(req)));
  },
  async clearRead(req: Request, res: Response) {
    send(res, await communicationService.clearRead(schoolId(req)));
  },
  async getPreferences(req: Request, res: Response) {
    send(res, await communicationService.getPreferences(schoolId(req)));
  },
  async savePreferences(req: Request, res: Response) {
    send(res, await communicationService.savePreferences(schoolId(req), req.body));
  },
};
