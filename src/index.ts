import { app } from './app';
import { connectDb } from './config/db';
import { env } from './config/env';
import { logger } from './lib/logger';

async function main(): Promise<void> {
  await connectDb();
  app.listen(env.PORT, () => {
    logger.info(`API listening on http://localhost:${env.PORT}/api (${env.NODE_ENV})`);
  });
}

main().catch((err) => {
  logger.error('Fatal startup error', err);
  process.exit(1);
});
