import multer from 'multer';

/**
 * Shared in-memory multipart upload handler — files never touch disk, the
 * buffer goes straight to `uploadToR2` (see `lib/storage.ts`). 5MB cap is
 * generous for a photo/scan; revisit per-route if a feature genuinely needs
 * larger files.
 */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});
