import type { Request, Response, NextFunction } from 'express';
import type { ZodType } from 'zod';

import { ApiError } from '../lib/api-error';

interface Schemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/**
 * Validate request parts against Zod schemas. On success, the parsed/coerced
 * `body` is written back to `req.body` (writable). `query`/`params` are
 * validated for correctness; controllers read them raw (they are strings)
 * and coerce trivially (see `pageParams`) — Express 5 makes `req.query`
 * read-only, so we don't reassign it.
 */
export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (schemas.params) {
      const r = schemas.params.safeParse(req.params);
      if (!r.success) throw ApiError.badRequest('Invalid path parameters', r.error.issues);
    }
    if (schemas.query) {
      const r = schemas.query.safeParse(req.query);
      if (!r.success) throw ApiError.badRequest('Invalid query parameters', r.error.issues);
    }
    if (schemas.body) {
      const r = schemas.body.safeParse(req.body);
      if (!r.success) throw ApiError.badRequest('Validation failed', r.error.issues);
      req.body = r.data;
    }
    next();
  };
}
