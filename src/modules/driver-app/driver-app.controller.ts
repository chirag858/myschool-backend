import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { send } from '../../lib/api-response';
import { driverAppService as S } from './driver-app.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
const gq = (req: Request, k: string): string => String(req.query[k] ?? '');
const bq = (req: Request, k: string): string => String((req.body ?? {})[k] ?? '');

export const driverAppController = {
  async assignment(req: Request, res: Response) {
    send(res, await S.assignment(schoolId(req)));
  },
  async manifest(req: Request, res: Response) {
    send(res, await S.manifest(schoolId(req), gq(req, 'routeId'), gq(req, 'tripId')));
  },
  async startTrip(req: Request, res: Response) {
    send(res, await S.startTrip(schoolId(req), bq(req, 'routeId'), bq(req, 'tripId')));
  },
  async endTrip(req: Request, res: Response) {
    send(res, await S.endTrip(schoolId(req), bq(req, 'tripId')));
  },
  async markBoarding(req: Request, res: Response) {
    send(res, await S.markBoarding(schoolId(req), bq(req, 'tripId'), bq(req, 'studentId'), bq(req, 'mark')));
  },
  async emit(req: Request, res: Response) {
    const { position, bearing, tripType, updatedAt } = req.body as { position: { lat: number; lng: number }; bearing?: number; tripType?: string; updatedAt?: number };
    send(res, await S.emit(schoolId(req), bq(req, 'tripId'), { position, bearing, tripType, updatedAt }));
  },
  async preview(req: Request, res: Response) {
    send(res, await S.preview(schoolId(req), gq(req, 'routeId')));
  },
  async alerts(req: Request, res: Response) {
    send(res, await S.alerts(schoolId(req)));
  },
  async triggerAlert(req: Request, res: Response) {
    send(res, await S.triggerAlert(schoolId(req), bq(req, 'tripId'), bq(req, 'type'), bq(req, 'stopId') || undefined));
  },
  async tripHistory(req: Request, res: Response) {
    send(res, await S.tripHistory(schoolId(req)));
  },
  async tripDetail(req: Request, res: Response) {
    send(res, await S.tripDetail(schoolId(req), gq(req, 'tripId')));
  },
};
