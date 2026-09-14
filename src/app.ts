import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';

import { env } from './config/env';
import { errorHandler } from './middleware/error';
import { notFound } from './middleware/not-found';
import { apiRouter } from './routes';

/**
 * Build the CORS origin check from `CORS_ORIGIN`. Entries are matched exactly,
 * and `*` in an entry is a wildcard for one host label — so
 * `https://*.vercel.app` allows every Vercel preview/prod URL and
 * `http://localhost:*` allows any dev port. `CORS_ORIGIN=*` allows all.
 */
function corsOrigin(): cors.CorsOptions['origin'] {
  if (env.CORS_ORIGIN === '*') return true;
  const patterns = env.CORS_ORIGIN.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) =>
      p.includes('*')
        ? new RegExp('^' + p.replace(/[.\\+?^${}()|[\]]/g, '\\$&').replace(/\*/g, '[^.]+') + '$')
        : p,
    );
  return (origin, cb) => {
    // Non-browser clients (curl, server-to-server) send no Origin — allow them.
    if (!origin) return cb(null, true);
    const ok = patterns.some((p) => (typeof p === 'string' ? p === origin : p.test(origin)));
    cb(null, ok);
  };
}

export function createApp(): express.Express {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: corsOrigin(),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true }));
  if (env.NODE_ENV !== 'test') app.use(morgan('dev'));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  app.use('/api', apiRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export const app = createApp();
