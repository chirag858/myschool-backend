import type { Request, Response } from 'express';

import { created, send } from '../../lib/api-response';
import { supportService } from './support.service';

const id = (req: Request): string => String(req.params.id);

export const supportController = {
  async getKpi(_req: Request, res: Response) {
    send(res, await supportService.getKpi());
  },
  async getTickets(req: Request, res: Response) {
    send(res, await supportService.getTickets(req.query as Record<string, string>));
  },
  async getTicket(req: Request, res: Response) {
    send(res, await supportService.getTicket(id(req)));
  },
  async createTicket(req: Request, res: Response) {
    const user = req.user!;
    created(
      res,
      await supportService.createTicket(req.body, {
        userId: user._id,
        role: user.role,
        schoolId: user.schoolId,
      }),
    );
  },
  async changeStatus(req: Request, res: Response) {
    const { status } = req.body as { status: string };
    send(res, await supportService.changeStatus(id(req), status));
  },
  async changePriority(req: Request, res: Response) {
    const { priority } = req.body as { priority: string };
    send(res, await supportService.changePriority(id(req), priority));
  },
  async assignTicket(req: Request, res: Response) {
    const { assignedTo } = req.body as { assignedTo: string };
    send(res, await supportService.assignTicket(id(req), assignedTo));
  },
  async getComments(req: Request, res: Response) {
    send(res, await supportService.getComments(id(req)));
  },
  async addComment(req: Request, res: Response) {
    const user = req.user!;
    created(
      res,
      await supportService.addComment(id(req), req.body, {
        userId: user._id,
        role: user.role,
      }),
    );
  },
  async getActivity(req: Request, res: Response) {
    send(res, await supportService.getActivity(id(req)));
  },
};
