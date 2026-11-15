import { connectDb, disconnectDb } from '../config/db';
import { logger } from '../lib/logger';
import { UserModel } from '../modules/user/user.model';

/**
 * Repairs stale `users` indexes on an existing database.
 *
 * The unique indexes on `email`+`schoolId` and `schoolId`+`username` used to be
 * plain compound uniques (or sparse compounds). A sparse/plain compound unique
 * still indexes a document whose `email` (or `username`) is missing as
 * `{ field: null, schoolId: X }`, so a SECOND parent account with no email in
 * the same school collided on `{ email: null, schoolId }` and the admission
 * failed with a raw Mongo E11000 — surfaced to the user as "Duplicate value".
 *
 * The schema (user.model.ts) was corrected to PARTIAL indexes
 * (`partialFilterExpression: { field: { $exists: true, $type: 'string' } }`),
 * but Mongoose `autoIndex` cannot replace an existing index that has the same
 * key with different options (IndexOptionsConflict) — it logs and keeps the old
 * one. So a database created before the fix still carries the stale index.
 *
 * `syncIndexes()` drops every index in the collection that does not match the
 * schema (by key AND options) and creates the ones that are missing — exactly
 * the stale -> partial swap we need. Safe to run repeatedly; a no-op once clean.
 */
async function main(): Promise<void> {
  await connectDb();

  const before = await UserModel.collection.indexes();
  logger.info({ indexes: before.map((i) => ({ name: i.name, key: i.key, unique: i.unique, partial: i.partialFilterExpression })) }, 'users indexes BEFORE');

  const dropped = await UserModel.syncIndexes();
  logger.info({ dropped }, 'syncIndexes dropped stale indexes');

  const after = await UserModel.collection.indexes();
  logger.info({ indexes: after.map((i) => ({ name: i.name, key: i.key, unique: i.unique, partial: i.partialFilterExpression })) }, 'users indexes AFTER');

  await disconnectDb();
  logger.info('fix-user-indexes done');
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
