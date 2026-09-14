import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { send } from '../../lib/api-response';
import { authService } from './auth.service';

export const authController = {
  async getConfig(_req: Request, res: Response) {
    send(res, authService.getConfig());
  },

  async login(req: Request, res: Response) {
    const { username, identifier, password, schoolCode } = req.body as {
      username?: string;
      identifier?: string;
      password: string;
      schoolCode?: string;
    };
    // Mobile sends `identifier` (username/email/mobile, no school code); web
    // staff send `username` + `schoolCode`. Route by which one is present.
    send(
      res,
      identifier
        ? await authService.passwordLogin(identifier, password, req.ip ?? '')
        : await authService.staffLogin(username as string, password, req.ip ?? '', schoolCode),
    );
  },

  async parentLogin(req: Request, res: Response) {
    const { identifier, password } = req.body as { identifier: string; password: string };
    send(res, await authService.passwordLogin(identifier, password, req.ip ?? ''));
  },

  async detect(req: Request, res: Response) {
    const { identifier } = req.body as { identifier: string };
    send(res, await authService.detect(identifier));
  },

  async sendOtp(req: Request, res: Response) {
    const { identifier, mobile } = req.body as { identifier?: string; mobile?: string };
    send(res, await authService.sendLoginOtp((identifier ?? mobile) as string));
  },

  async verifyOtp(req: Request, res: Response) {
    const { identifier, mobile, otp } = req.body as {
      identifier?: string;
      mobile?: string;
      otp: string;
    };
    send(res, await authService.verifyLoginOtp((identifier ?? mobile) as string, otp));
  },

  async refresh(req: Request, res: Response) {
    const { refreshToken } = req.body as { refreshToken: string };
    send(res, await authService.refresh(refreshToken));
  },

  async profile(req: Request, res: Response) {
    if (!req.user) throw ApiError.unauthorized();
    send(res, await authService.getProfile(req.user._id));
  },

  async context(req: Request, res: Response) {
    if (!req.user) throw ApiError.unauthorized();
    send(res, await authService.getContext(req.user._id));
  },

  async updateProfile(req: Request, res: Response) {
    if (!req.user) throw ApiError.unauthorized();
    send(res, await authService.updateProfile(req.user._id, req.body));
  },

  async changePassword(req: Request, res: Response) {
    if (!req.user) throw ApiError.unauthorized();
    const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
    send(res, await authService.changePassword(req.user._id, currentPassword, newPassword));
  },

  async logout(_req: Request, res: Response) {
    // Stateless JWT — client discards tokens. Endpoint exists for parity.
    send(res, { success: true });
  },

  async forgotSendOtp(req: Request, res: Response) {
    const { username, contact, schoolCode } = req.body as {
      username?: string;
      contact: string;
      schoolCode?: string;
    };
    send(res, await authService.forgotSendOtp(username, contact, schoolCode));
  },

  async forgotReset(req: Request, res: Response) {
    const { username, contact, otp, password, schoolCode } = req.body as {
      username?: string;
      contact: string;
      otp: string;
      password: string;
      schoolCode?: string;
    };
    send(res, await authService.forgotReset(username, contact, otp, password, schoolCode));
  },
};
