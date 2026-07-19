import mongoose from 'mongoose';

import { env } from './env';
import { logger } from '../lib/logger';

export async function connectDb(uri: string = env.MONGO_URI): Promise<void> {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  logger.info('MongoDB connected');
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
