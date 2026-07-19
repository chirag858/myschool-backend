import type { Request, Response, NextFunction } from 'express';

import { ApiError } from '../lib/api-error';
import { verifyAccess } from '../lib/jwt';

export interface AuthUser {
  _id: string;
  role: string;
  schoolId?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Verify the bearer access token → req.user. Throws 401 on failure. */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw ApiError.unauthorized('Missing bearer token');
  }
  try {
    const payload = verifyAccess(header.slice(7));
    req.user = { _id: payload.sub, role: payload.role, schoolId: payload.schoolId };
    next();
  } catch {
    throw ApiError.unauthorized('Invalid or expired token');
  }
}

/** Gate a route to specific roles. Assumes `authenticate` ran first. */
export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw ApiError.unauthorized();
    if (!roles.includes(req.user.role)) throw ApiError.forbidden('Insufficient role');
    next();
  };
}

/** Resolve the tenant filter for the current user. super_admin = no scope. */
export function tenantFilter(req: Request): Record<string, unknown> {
  if (!req.user) throw ApiError.unauthorized();
  if (req.user.role === 'super_admin') return {};
  if (!req.user.schoolId) throw ApiError.forbidden('User has no school scope');
  return { schoolId: req.user.schoolId };
}
