import { randomUUID } from 'crypto';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { env } from '../config/env';

let client: S3Client | null = null;

function r2Client(): S3Client {
  if (client) return client;
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new Error('R2 storage is not configured (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY missing)');
  }
  client = new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
  return client;
}

/**
 * Uploads a file buffer to the school's Cloudflare R2 bucket and returns the
 * public URL. `folder` groups objects by feature (e.g. `student-photos`,
 * `staff-documents`) so a bucket listing stays navigable; the returned key
 * is prefixed with `schoolId` so one shared bucket stays tenant-isolated.
 */
export async function uploadToR2(params: {
  schoolId: string;
  folder: string;
  fileName: string;
  buffer: Buffer;
  mimeType: string;
}): Promise<{ url: string; key: string }> {
  if (!env.R2_BUCKET || !env.R2_PUBLIC_URL) {
    throw new Error('R2 storage is not configured (R2_BUCKET / R2_PUBLIC_URL missing)');
  }
  const ext = params.fileName.includes('.') ? params.fileName.slice(params.fileName.lastIndexOf('.')) : '';
  const key = `${params.schoolId}/${params.folder}/${randomUUID()}${ext}`;

  await r2Client().send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
      Body: params.buffer,
      ContentType: params.mimeType,
    }),
  );

  const base = env.R2_PUBLIC_URL.replace(/\/$/, '');
  return { url: `${base}/${key}`, key };
}
