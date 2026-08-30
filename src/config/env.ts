import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),
  MONGO_URI: z.string().default('mongodb://127.0.0.1:27017/myschool'),
  JWT_ACCESS_SECRET: z.string().min(1).default('dev-access-secret-change-me'),
  JWT_REFRESH_SECRET: z.string().min(1).default('dev-refresh-secret-change-me'),
  // Token lifetimes in seconds.
  JWT_ACCESS_TTL: z.coerce.number().default(3600),
  JWT_REFRESH_TTL: z.coerce.number().default(2592000),
  CORS_ORIGIN: z.string().default('*'),
  // Cloudflare R2 (S3-compatible object storage) for real file uploads —
  // optional so dev/test can run without them; upload routes check for
  // their presence and error clearly if a school tries to upload without
  // storage configured.
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_URL: z.string().optional(),
  // SMTP (transactional email — password-reset OTP, etc.) — optional so
  // dev/test run without it; `lib/mailer.ts` throws a clear error if a
  // send is attempted while unconfigured. For Gmail use an App Password
  // (Google Account → Security → 2-Step Verification → App passwords),
  // not the account password.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
});

export const env = schema.parse(process.env);
export type Env = typeof env;
