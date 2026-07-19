import type { Response } from 'express';

/**
 * Success responses send the payload as the RAW body — the frontend reads
 * `response.data` as the payload directly (e.g. `return response.data` typed
 * as `Receipt[]`). No `{ success, data }` envelope. Errors are the only
 * structured bodies (see the error handler): `{ message, code, details? }`.
 */
export function send<T>(res: Response, payload: T, status = 200): Response {
  return res.status(status).json(payload);
}

export function created<T>(res: Response, payload: T): Response {
  return res.status(201).json(payload);
}

export function noContent(res: Response): Response {
  return res.status(204).send();
}
