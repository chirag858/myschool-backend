import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll } from 'vitest';

let mongo: MongoMemoryServer | undefined;

beforeAll(async () => {
  // Retry the ephemeral mongod start with backoff — flaky under start/stop churn.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      mongo = await MongoMemoryServer.create();
      lastErr = undefined;
      break;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  if (!mongo) throw lastErr;
  await mongoose.connect(mongo.getUri());
  // Build unique indexes up front so the first request never races a build.
  await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).init()));
});

afterEach(async () => {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect().catch(() => undefined);
  await mongo?.stop().catch(() => undefined);
});
