import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { parentAppService as S } from './parent-app.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
const uid = (req: Request): string => String(req.user?._id);
const gq = (req: Request, k: string): string => String(req.query[k] ?? '');
const bq = (req: Request, k: string): string => String((req.body ?? {})[k] ?? '');
const childG = (req: Request): string => gq(req, 'childId');
const childB = (req: Request): string => bq(req, 'childId');

export const parentAppController = {
  async children(req: Request, res: Response) {
    send(res, await S.children(schoolId(req), uid(req)));
  },
  async dashboardSummary(req: Request, res: Response) {
    send(res, await S.dashboardSummary(schoolId(req), uid(req), childG(req)));
  },
  async profile(req: Request, res: Response) {
    send(res, await S.profile(schoolId(req), uid(req), childG(req)));
  },
  async attendance(req: Request, res: Response) {
    send(res, await S.attendance(schoolId(req), uid(req), childG(req), gq(req, 'month') || undefined));
  },

  async examTimetable(req: Request, res: Response) {
    send(res, await S.examTimetable(schoolId(req), uid(req), childG(req)));
  },
  async examSchedules(req: Request, res: Response) {
    send(res, await S.examSchedules(schoolId(req), uid(req), childG(req)));
  },
  async examMarks(req: Request, res: Response) {
    send(res, await S.examMarks(schoolId(req), uid(req), childG(req)));
  },

  async feeDues(req: Request, res: Response) {
    send(res, await S.feeDues(schoolId(req), uid(req), childG(req)));
  },
  async feeReceipts(req: Request, res: Response) {
    send(res, await S.feeReceipts(schoolId(req), uid(req), childG(req)));
  },
  async feeLedger(req: Request, res: Response) {
    send(res, await S.feeLedger(schoolId(req), uid(req), childG(req)));
  },
  async paymentOrder(req: Request, res: Response) {
    send(res, await S.paymentOrder(schoolId(req), uid(req), childB(req), Number(req.body.amount ?? 0)));
  },
  async paymentVerify(req: Request, res: Response) {
    send(res, await S.paymentVerify(schoolId(req), uid(req), childB(req), bq(req, 'orderId')));
  },

  async notifications(req: Request, res: Response) {
    send(res, await S.notifications(schoolId(req), uid(req), childG(req)));
  },
  async markNotifRead(req: Request, res: Response) {
    await S.markNotifRead(schoolId(req), uid(req), bq(req, 'id'));
    send(res, { success: true });
  },
  async markAllNotifRead(req: Request, res: Response) {
    await S.markAllNotifRead(schoolId(req), uid(req));
    send(res, { success: true });
  },

  async complaints(req: Request, res: Response) {
    send(res, await S.complaints(schoolId(req), uid(req), childG(req)));
  },
  async submitComplaint(req: Request, res: Response) {
    created(res, await S.submitComplaint(schoolId(req), uid(req), childB(req), (req.body.values ?? {}) as Record<string, string>));
  },

  async requests(req: Request, res: Response) {
    send(res, await S.requests(schoolId(req), uid(req), childG(req), gq(req, 'type') || undefined));
  },
  async submitRequest(req: Request, res: Response) {
    created(res, await S.submitRequest(schoolId(req), uid(req), childB(req), bq(req, 'type'), (req.body.values ?? {}) as Record<string, string>));
  },
  async cancelRequest(req: Request, res: Response) {
    send(res, await S.cancelRequest(schoolId(req), uid(req), childB(req), bq(req, 'id')));
  },

  async outpasses(req: Request, res: Response) {
    send(res, await S.outpasses(schoolId(req), uid(req), childG(req)));
  },
  async outpassOtp(req: Request, res: Response) {
    send(res, await S.outpassOtp(schoolId(req), uid(req), childB(req), bq(req, 'id')));
  },
  async outpassApprove(req: Request, res: Response) {
    send(res, await S.outpassApprove(schoolId(req), uid(req), childB(req), bq(req, 'id'), bq(req, 'otp')));
  },
  async outpassDecline(req: Request, res: Response) {
    send(res, await S.outpassDecline(schoolId(req), uid(req), childB(req), bq(req, 'id')));
  },

  async conversations(req: Request, res: Response) {
    send(res, await S.conversations(schoolId(req), uid(req), childG(req)));
  },
  async thread(req: Request, res: Response) {
    send(res, await S.thread(schoolId(req), uid(req), gq(req, 'conversationId')));
  },
  async sendMessage(req: Request, res: Response) {
    send(res, await S.sendMessage(schoolId(req), uid(req), bq(req, 'conversationId'), bq(req, 'body')));
  },
  async markConvRead(req: Request, res: Response) {
    await S.markConvRead(schoolId(req), uid(req), bq(req, 'conversationId'));
    send(res, { success: true });
  },

  async transportAssignment(req: Request, res: Response) {
    send(res, await S.transportAssignment(schoolId(req), uid(req), childG(req)));
  },
  async transportLive(req: Request, res: Response) {
    send(res, await S.transportLive(schoolId(req), uid(req), childG(req)));
  },

  async bag(req: Request, res: Response) {
    send(res, await S.bag(schoolId(req), uid(req), childG(req)));
  },
  async rewards(req: Request, res: Response) {
    send(res, await S.rewards(schoolId(req), uid(req), childG(req)));
  },
  async classIncharge(req: Request, res: Response) {
    send(res, await S.classIncharge(schoolId(req), uid(req), childG(req)));
  },
  async onlineClasses(req: Request, res: Response) {
    send(res, await S.onlineClasses(schoolId(req), uid(req), childG(req)));
  },
};
