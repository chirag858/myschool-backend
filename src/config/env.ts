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
});

export const env = schema.parse(process.env);
export type Env = typeof env;
