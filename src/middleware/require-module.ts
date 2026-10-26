import type { NextFunction, Request, Response } from 'express';

import { ApiError } from '../lib/api-error';
import { MODULE_KEYS, SchoolModel } from '../modules/school/school.model';
import { PLATFORM_ROLES } from '../modules/user/roles';

type ModuleKey = (typeof MODULE_KEYS)[number];

/**
 * Gate a route behind a super-admin module toggle (`School.moduleFlags`).
 * Assumes `authenticate` ran first. Platform roles (super_admin,
 * support_engineer) bypass — they manage the flags and have no schoolId
 * of their own; every other role is scoped to its own school and blocked
 * with 403 if the school's flag is off. Absent flag defaults to enabled —
 * mirrors school.service#fullModules.
 */
export function requireModule(key: ModuleKey) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) throw ApiError.unauthorized();
    if (PLATFORM_ROLES.includes(req.user.role as (typeof PLATFORM_ROLES)[number])) return next();
    if (!req.user.schoolId) throw ApiError.forbidden('User has no school scope');

    const school = await SchoolModel.findById(req.user.schoolId).select('moduleFlags').lean();
    if (!school) throw ApiError.notFound('School not found');

    const flags = school.moduleFlags as Record<string, boolean> | undefined;
    const enabled = flags?.[key] !== false;
    if (!enabled) throw ApiError.forbidden(`Module "${key}" is disabled for this school`);
    next();
  };
}
