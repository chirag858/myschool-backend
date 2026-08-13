import cron from 'node-cron';

import { app } from './app';
import { connectDb } from './config/db';
import { env } from './config/env';
import { logger } from './lib/logger';
import { feeRecoveryService } from './modules/fee/fee-recovery.service';

function startScheduledJobs(): void {
  // Once a day at 08:00 — evaluate active fee reminder rules and dispatch.
  cron.schedule('0 8 * * *', () => {
    feeRecoveryService
      .runReminderRules()
      .then((res) => logger.info('Reminder rules run', res))
      .catch((err) => logger.error('Reminder rules run failed', err));
  });
}

async function main(): Promise<void> {
  await connectDb();
  startScheduledJobs();
  app.listen(env.PORT, () => {
    logger.info(`API listening on http://localhost:${env.PORT}/api (${env.NODE_ENV})`);
  });
}

main().catch((err) => {
  logger.error('Fatal startup error', err);
  process.exit(1);
});
