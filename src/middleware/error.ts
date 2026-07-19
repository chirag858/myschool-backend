import type { Request, Response, NextFunction } from 'express';

import { ApiError } from '../lib/api-error';
import { logger } from '../lib/logger';

interface MongoLikeError {
  code?: number;
  name?: string;
  message?: string;
}

/** Central error formatter. Error body: { message, code, details? }. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({
      message: err.message,
      code: err.code,
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }

  const e = err as MongoLikeError;
  if (e?.code === 11000) {
    res.status(409).json({ message: 'Duplicate value', code: 'CONFLICT' });
    return;
  }
  if (e?.name === 'ValidationError') {
    res.status(400).json({ message: e.message ?? 'Validation failed', code: 'VALIDATION_ERROR' });
    return;
  }
  if (e?.name === 'CastError') {
    res.status(400).json({ message: 'Invalid identifier', code: 'VALIDATION_ERROR' });
    return;
  }

  logger.error(err);
  res.status(500).json({ message: 'Internal server error', code: 'INTERNAL' });
}
