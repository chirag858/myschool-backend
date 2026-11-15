import { ApiError } from '../../lib/api-error';
import { UserModel } from '../user/user.model';
import { SyllabusModel } from './syllabus.model';
import type { CreateSyllabusInput, UpdateSyllabusInput } from './syllabus.validation';

type Lean = Record<string, unknown>;

function docOut(d: Lean): Record<string, unknown> {
  return {
    id: String(d._id),
    title: d.title,
    classKey: d.classKey,
    subject: d.subject ?? '',
    term: d.term ?? '',
    fileUrl: d.fileUrl,
    fileName: d.fileName ?? '',
    createdBy: d.createdBy ?? '',
    createdAt: d.createdAt,
  };
}

export const syllabusService = {
  /** Staff: every syllabus doc in the school, optionally filtered by class. */
  async list(schoolId: string, classKey?: string) {
    const filter: Record<string, unknown> = { schoolId };
    if (classKey) filter.classKey = classKey;
    const rows = await SyllabusModel.find(filter).sort({ createdAt: -1 }).lean();
    return { rows: rows.map((d) => docOut(d as Lean)) };
  },

  async create(schoolId: string, createdById: string, input: CreateSyllabusInput) {
    const creator = await UserModel.findById(createdById).select('name').lean();
    const doc = await SyllabusModel.create({
      schoolId,
      title: input.title,
      classKey: input.classKey,
      subject: input.subject ?? '',
      term: input.term ?? '',
      fileUrl: input.fileUrl,
      fileName: input.fileName ?? '',
      fileKey: input.fileKey ?? '',
      createdById,
      createdBy: (creator?.name as string) ?? '',
    });
    return docOut(doc.toObject() as Lean);
  },

  async update(schoolId: string, id: string, input: UpdateSyllabusInput) {
    const d = await SyllabusModel.findOneAndUpdate({ _id: id, schoolId }, { $set: input }, { new: true }).lean();
    if (!d) throw ApiError.notFound('Syllabus not found');
    return docOut(d as Lean);
  },

  async remove(schoolId: string, id: string) {
    const r = await SyllabusModel.deleteOne({ _id: id, schoolId });
    if (r.deletedCount === 0) throw ApiError.notFound('Syllabus not found');
  },

  /** Parent: syllabus docs for a child's class, newest first. */
  async listForClass(schoolId: string, classKey: string) {
    const rows = await SyllabusModel.find({ schoolId, classKey }).sort({ createdAt: -1 }).lean();
    return rows.map((d) => docOut(d as Lean));
  },
};
