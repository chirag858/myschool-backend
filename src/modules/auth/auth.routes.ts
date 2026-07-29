import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { authController } from './auth.controller';
import {
  changePasswordSchema,
  detectSchema,
  forgotResetSchema,
  forgotSendSchema,
  loginSchema,
  otpRequestSchema,
  parentLoginSchema,
  refreshSchema,
  updateProfileSchema,
  verifyOtpSchema,
} from './auth.validation';

export const authRoutes = Router();

authRoutes.get('/config', asyncHandler(authController.getConfig));
authRoutes.post('/login', validate({ body: loginSchema }), asyncHandler(authController.login));
authRoutes.post(
  '/parent-login',
  validate({ body: parentLoginSchema }),
  asyncHandler(authController.parentLogin),
);
authRoutes.post('/detect', validate({ body: detectSchema }), asyncHandler(authController.detect));
// OTP: /otp/send (web) + /otp/request + /otp/resend (mobile) all dispatch a login OTP.
authRoutes.post('/otp/send', validate({ body: otpRequestSchema }), asyncHandler(authController.sendOtp));
authRoutes.post('/otp/request', validate({ body: otpRequestSchema }), asyncHandler(authController.sendOtp));
authRoutes.post('/otp/resend', validate({ body: otpRequestSchema }), asyncHandler(authController.sendOtp));
authRoutes.post(
  '/otp/verify',
  validate({ body: verifyOtpSchema }),
  asyncHandler(authController.verifyOtp),
);
authRoutes.post('/refresh', validate({ body: refreshSchema }), asyncHandler(authController.refresh));
authRoutes.get('/profile', authenticate, asyncHandler(authController.profile));
authRoutes.get('/context', authenticate, asyncHandler(authController.context));
authRoutes.put(
  '/profile',
  authenticate,
  validate({ body: updateProfileSchema }),
  asyncHandler(authController.updateProfile),
);
authRoutes.post(
  '/change-password',
  authenticate,
  validate({ body: changePasswordSchema }),
  asyncHandler(authController.changePassword),
);
authRoutes.post('/logout', asyncHandler(authController.logout));
authRoutes.post(
  '/forgot-password/send-otp',
  validate({ body: forgotSendSchema }),
  asyncHandler(authController.forgotSendOtp),
);
authRoutes.post(
  '/forgot-password/reset',
  validate({ body: forgotResetSchema }),
  asyncHandler(authController.forgotReset),
);
