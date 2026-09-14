import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { send } from '../../lib/api-response';
import { driverAppService as S } from './driver-app.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
function userId(req: Request): string {
  const id = req.user?._id;
  if (!id) throw ApiError.unauthorized('Not signed in');
  return String(id);
}
const bq = (req: Request, k: string): string => String((req.body ?? {})[k] ?? '');

export const driverAppController = {
  async myBus(req: Request, res: Response) {
    send(res, await S.myBus(schoolId(req), userId(req)));
  },
  async myBusStudents(req: Request, res: Response) {
    send(res, await S.myBusStudents(schoolId(req), userId(req)));
  },
  async startBusTrip(req: Request, res: Response) {
    send(res, await S.startBusTrip(schoolId(req), userId(req), bq(req, 'type')));
  },
  async endBusTrip(req: Request, res: Response) {
    send(res, await S.endBusTrip(schoolId(req), userId(req)));
  },
  async dutyWait(req: Request, res: Response) {
    send(res, await S.dutyWait(schoolId(req), userId(req)));
  },
  async dutyPosition(req: Request, res: Response) {
    const b = (req.body ?? {}) as { reqId?: string; lat?: number; lng?: number; accuracy?: number; at?: number };
    send(
      res,
      await S.dutyPosition(schoolId(req), userId(req), String(b.reqId ?? ''), {
        lat: Number(b.lat),
        lng: Number(b.lng),
        accuracy: typeof b.accuracy === 'number' ? b.accuracy : undefined,
        at: typeof b.at === 'number' ? b.at : Date.now(),
      }),
    );
  },
};
