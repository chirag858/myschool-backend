import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { send } from '../../lib/api-response';
import { authService } from './auth.service';

export const authController = {
  async getConfig(_req: Request, res: Response) {
    send(res, authService.getConfig());
  },

  async login(req: Request, res: Response) {
    const { username, identifier, password } = req.body as {
      username?: string;
      identifier?: string;
      password: string;
    };
    send(res, await authService.passwordLogin((identifier ?? username) as string, password));
  },

  async parentLogin(req: Request, res: Response) {
    const { identifier, password } = req.body as { identifier: string; password: string };
    send(res, await authService.passwordLogin(identifier, password));
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

  async logout(_req: Request, res: Response) {
    // Stateless JWT — client discards tokens. Endpoint exists for parity.
    send(res, { success: true });
  },

  async forgotSendOtp(req: Request, res: Response) {
    const { contact, username } = req.body as { contact: string; username?: string };
    send(res, await authService.forgotSendOtp(contact, username));
  },

  async forgotReset(req: Request, res: Response) {
    const { contact, username, otp, password } = req.body as {
      contact: string;
      username?: string;
      otp: string;
      password: string;
    };
    send(res, await authService.forgotReset(contact, otp, password, username));
  },
};
