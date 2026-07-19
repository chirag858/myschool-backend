import jwt from 'jsonwebtoken';

import { env } from '../config/env';

export interface JwtPayload {
  sub: string;
  role: string;
  schoolId?: string;
}

/** Matches the frontend `Tokens` type. `expiresAt` is a ms epoch. */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export function signTokens(payload: JwtPayload): TokenPair {
  const accessToken = jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL,
  });
  const refreshToken = jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_TTL,
  });
  const decoded = jwt.decode(accessToken) as { exp: number };
  return { accessToken, refreshToken, expiresAt: decoded.exp * 1000 };
}

export function verifyAccess(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
}

export function verifyRefresh(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as JwtPayload;
}
