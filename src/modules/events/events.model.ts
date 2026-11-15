import { Schema, model, type InferSchemaType } from 'mongoose';

const school = { type: Schema.Types.ObjectId, ref: 'School', required: true, index: true } as const;

/** One photo inside an album. `key` is the R2 object key (kept for future
 *  cleanup); `url` is what the client renders / downloads. */
const eventPhotoSchema = new Schema(
  {
    url: { type: String, required: true },
    key: { type: String, default: '' },
    caption: { type: String, default: '' },
    uploadedAt: { type: String, default: () => new Date().toISOString() },
  },
  { _id: true },
);

/**
 * An Events / activity photo album. A teacher or school admin creates an album
 * and uploads photos; parents of the targeted classes view and download them.
 *
 * Targeting: `classKeys` holds `${className}-${section}` strings (same shape as
 * parent-app `classKeyOf`). An EMPTY array = whole-school (every parent sees it).
 */
const eventAlbumSchema = new Schema(
  {
    schoolId: school,
    title: { type: String, required: true },
    description: { type: String, default: '' },
    eventDate: { type: String, default: '' },
    // Empty = whole school; otherwise the classes (className-section) that see it.
    classKeys: { type: [String], default: [] },
    coverUrl: { type: String, default: '' },
    photos: { type: [eventPhotoSchema], default: [] },
    createdById: { type: String, default: '' },
    createdBy: { type: String, default: '' },
  },
  { timestamps: true },
);
eventAlbumSchema.index({ schoolId: 1, createdAt: -1 });

export type EventAlbum = InferSchemaType<typeof eventAlbumSchema>;
export const EventAlbumModel = model('EventAlbum', eventAlbumSchema);
