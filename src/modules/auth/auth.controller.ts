import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { send } from '../../lib/api-response';
import { authService } from './auth.service';

export const authController = {
  async getConfig(_req: Request, res: Response) {
    send(res, authService.getConfig());
  },

  async login(req: Request, res: Response) {
    const { username, password } = req.body as { username: string; password: string };
    send(res, await authService.staffLogin(username, password));
  },

  async detect(req: Request, res: Response) {
    const { identifier } = req.body as { identifier: string };
    send(res, await authService.detect(identifier));
  },

  async sendOtp(req: Request, res: Response) {
    const { mobile } = req.body as { mobile: string };
    send(res, await authService.sendLoginOtp(mobile));
  },

  async verifyOtp(req: Request, res: Response) {
    const { mobile, otp } = req.body as { mobile: string; otp: string };
    send(res, await authService.verifyLoginOtp(mobile, otp));
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
    const { username, contact } = req.body as { username: string; contact: string };
    send(res, await authService.forgotSendOtp(username, contact));
  },

  async forgotReset(req: Request, res: Response) {
    const { username, contact, otp, password } = req.body as {
      username: string;
      contact: string;
      otp: string;
      password: string;
    };
    send(res, await authService.forgotReset(username, contact, otp, password));
  },
};
