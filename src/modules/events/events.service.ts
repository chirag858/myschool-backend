import { ApiError } from '../../lib/api-error';
import { UserModel } from '../user/user.model';
import { EventAlbumModel } from './events.model';
import type { AddPhotoInput, CreateAlbumInput, UpdateAlbumInput } from './events.validation';

type Lean = Record<string, unknown>;

/** Photo sub-doc as returned to any client (stable `id`, never the raw _id). */
function photoOut(p: Lean): Record<string, unknown> {
  return {
    id: String(p._id),
    url: p.url,
    caption: p.caption ?? '',
    uploadedAt: p.uploadedAt ?? '',
  };
}

/** Album as returned to a client. `photos` optional — list views omit them. */
function albumOut(a: Lean, withPhotos: boolean): Record<string, unknown> {
  const photos = (a.photos as Lean[]) ?? [];
  return {
    id: String(a._id),
    title: a.title,
    description: a.description ?? '',
    eventDate: a.eventDate ?? '',
    classKeys: a.classKeys ?? [],
    coverUrl: a.coverUrl || (photos[0]?.url ?? ''),
    photoCount: photos.length,
    createdBy: a.createdBy ?? '',
    createdAt: a.createdAt,
    ...(withPhotos ? { photos: photos.map(photoOut) } : {}),
  };
}

/** Does an album target a given class? Empty classKeys = whole school. */
function targetsClass(classKeys: readonly string[] | undefined, classKey: string): boolean {
  if (!classKeys || classKeys.length === 0) return true;
  return classKeys.includes(classKey);
}

export const eventsService = {
  /** Staff: every album in the school, newest first (no photos in the list). */
  async list(schoolId: string) {
    const rows = await EventAlbumModel.find({ schoolId }).sort({ createdAt: -1 }).lean();
    return { rows: rows.map((a) => albumOut(a as Lean, false)) };
  },

  async getById(schoolId: string, id: string) {
    const a = await EventAlbumModel.findOne({ _id: id, schoolId }).lean();
    if (!a) throw ApiError.notFound('Album not found');
    return albumOut(a as Lean, true);
  },

  async create(schoolId: string, createdById: string, input: CreateAlbumInput) {
    const creator = await UserModel.findById(createdById).select('name').lean();
    const doc = await EventAlbumModel.create({
      schoolId,
      title: input.title,
      description: input.description ?? '',
      eventDate: input.eventDate ?? '',
      classKeys: input.classKeys ?? [],
      createdById,
      createdBy: (creator?.name as string) ?? '',
    });
    return albumOut(doc.toObject() as Lean, true);
  },

  async update(schoolId: string, id: string, input: UpdateAlbumInput) {
    const a = await EventAlbumModel.findOneAndUpdate({ _id: id, schoolId }, { $set: input }, { new: true }).lean();
    if (!a) throw ApiError.notFound('Album not found');
    return albumOut(a as Lean, true);
  },

  async addPhoto(schoolId: string, id: string, input: AddPhotoInput) {
    const a = await EventAlbumModel.findOneAndUpdate(
      { _id: id, schoolId },
      { $push: { photos: { url: input.url, key: input.key ?? '', caption: input.caption ?? '' } } },
      { new: true },
    ).lean();
    if (!a) throw ApiError.notFound('Album not found');
    // First photo becomes the cover if none set yet.
    const photos = (a.photos as unknown as Lean[]) ?? [];
    if (!a.coverUrl && photos.length) {
      await EventAlbumModel.updateOne({ _id: id, schoolId }, { $set: { coverUrl: photos[0].url } });
    }
    return albumOut(a as Lean, true);
  },

  async removePhoto(schoolId: string, id: string, photoId: string) {
    const a = await EventAlbumModel.findOneAndUpdate(
      { _id: id, schoolId },
      { $pull: { photos: { _id: photoId } } },
      { new: true },
    ).lean();
    if (!a) throw ApiError.notFound('Album not found');
    return albumOut(a as Lean, true);
  },

  async remove(schoolId: string, id: string) {
    const r = await EventAlbumModel.deleteOne({ _id: id, schoolId });
    if (r.deletedCount === 0) throw ApiError.notFound('Album not found');
  },

  /** Parent: albums visible to a child's class, newest first (no photos). */
  async listForClass(schoolId: string, classKey: string) {
    const rows = await EventAlbumModel.find({ schoolId }).sort({ createdAt: -1 }).lean();
    return rows
      .filter((a) => targetsClass(a.classKeys as string[] | undefined, classKey))
      .map((a) => albumOut(a as Lean, false));
  },

  /** Parent: one album with photos, only if it targets the child's class. */
  async getForClass(schoolId: string, classKey: string, id: string) {
    const a = await EventAlbumModel.findOne({ _id: id, schoolId }).lean();
    if (!a || !targetsClass(a.classKeys as string[] | undefined, classKey)) {
      throw ApiError.notFound('Album not found');
    }
    return albumOut(a as Lean, true);
  },
};
