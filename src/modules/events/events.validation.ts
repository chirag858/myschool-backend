import { z } from 'zod';

export const idParam = z.object({ id: z.string().min(1) });
export const photoParams = z.object({ id: z.string().min(1), photoId: z.string().min(1) });

export const createAlbumSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
  eventDate: z.string().trim().max(40).optional(),
  classKeys: z.array(z.string().trim().min(1)).default([]),
});

export const updateAlbumSchema = createAlbumSchema.partial();

/** Attach an already-uploaded photo URL to an album (upload returns the URL). */
export const addPhotoSchema = z.object({
  url: z.string().url(),
  key: z.string().optional(),
  caption: z.string().trim().max(300).optional(),
});

export type CreateAlbumInput = z.infer<typeof createAlbumSchema>;
export type UpdateAlbumInput = z.infer<typeof updateAlbumSchema>;
export type AddPhotoInput = z.infer<typeof addPhotoSchema>;
