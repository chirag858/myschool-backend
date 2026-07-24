import { Types } from 'mongoose';

import { ApiError } from '../../lib/api-error';
import { StudentModel } from './student.model';

type Doc = Record<string, unknown> & { _id: unknown };

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const iso = (v: unknown): string => (v ? new Date(v as string).toISOString() : '');

function toRow(d: Doc) {
  return {
    id: String(d._id),
    admissionNumber: d.admissionNumber,
    name: d.name,
    fatherName: d.fatherName ?? '',
    className: d.className ?? '',
    section: d.section ?? '',
    admissionType: d.admissionType,
    admittedAt: iso(d.admittedAt),
    feeStatus: d.feeStatus,
    profileStatus: d.profileStatus,
    photoUrl: d.photoUrl,
    mobile: d.mobile ?? '',
    classKey: d.classKey ?? '',
  };
}

function toProfile(d: Doc) {
  const docs = (d.documents as Array<Record<string, unknown> & { _id: unknown }>) ?? [];
  return {
    id: String(d._id),
    admissionNumber: d.admissionNumber,
    rollNumber: d.rollNumber ?? '',
    name: d.name,
    dateOfBirth: d.dateOfBirth ?? '',
    gender: d.gender,
    bloodGroup: d.bloodGroup,
    religion: d.religion,
    caste: d.caste,
    category: d.category,
    nationality: d.nationality,
    aadhaar: d.aadhaar,
    photoUrl: d.photoUrl,
    className: d.className ?? '',
    section: d.section ?? '',
    classKey: d.classKey ?? '',
    sessionLabel: d.sessionLabel ?? '',
    admittedAt: iso(d.admittedAt),
    admissionType: d.admissionType,
    profileStatus: d.profileStatus,
    feeStatus: d.feeStatus,
    parents: d.parents ?? {},
    currentAddress: d.currentAddress ?? {},
    permanentAddress: d.permanentAddress ?? {},
    permanentSameAsCurrent: d.permanentSameAsCurrent ?? true,
    previousAcademic: d.previousAcademic,
    documents: docs.map((doc) => ({
      id: String(doc._id),
      type: doc.type,
      customLabel: doc.customLabel,
      fileName: doc.fileName,
      sizeBytes: doc.sizeBytes,
      uploadedAt: doc.uploadedAt,
      verification: doc.verification,
    })),
  };
}

interface StudentsQuery {
  page?: number;
  pageSize?: number;
  classKey?: string;
  section?: string;
  admissionType?: string;
  profileStatus?: string;
  feeStatus?: string;
  search?: string;
  fromDate?: string;
  toDate?: string;
}

export const studentsService = {
  async list(schoolId: string, query: StudentsQuery) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.max(1, Number(query.pageSize) || 10);

    const filter: Record<string, unknown> = { schoolId };
    if (query.classKey && query.classKey !== 'all') filter.classKey = query.classKey;
    if (query.section && query.section !== 'all') filter.section = query.section;
    if (query.admissionType && query.admissionType !== 'all') filter.admissionType = query.admissionType;
    if (query.profileStatus && query.profileStatus !== 'all') filter.profileStatus = query.profileStatus;
    if (query.feeStatus && query.feeStatus !== 'all') filter.feeStatus = query.feeStatus;
    if (query.search?.trim()) {
      const rx = new RegExp(escapeRegex(query.search.trim()), 'i');
      filter.$or = [{ name: rx }, { admissionNumber: rx }, { fatherName: rx }, { mobile: rx }];
    }
    if (query.fromDate || query.toDate) {
      const range: Record<string, Date> = {};
      if (query.fromDate) range.$gte = new Date(query.fromDate);
      if (query.toDate) range.$lte = new Date(query.toDate);
      filter.admittedAt = range;
    }

    const [docs, total] = await Promise.all([
      StudentModel.find(filter)
        .sort({ admittedAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      StudentModel.countDocuments(filter),
    ]);

    return { rows: docs.map(toRow), total, page, pageSize };
  },

  async classSummary(schoolId: string) {
    const agg = await StudentModel.aggregate<{
      _id: { classKey: string; className: string };
      count: number;
    }>([
      { $match: { schoolId: new Types.ObjectId(schoolId) } },
      { $group: { _id: { classKey: '$classKey', className: '$className' }, count: { $sum: 1 } } },
      { $sort: { '_id.className': 1 } },
    ]);
    return agg.map((a) => ({
      classKey: a._id.classKey,
      className: a._id.className,
      studentCount: a.count,
    }));
  },

  async create(schoolId: string, payload: Record<string, unknown>) {
    const className = String(payload.className);
    const section = String(payload.section);
    const admissionNumber = String(payload.admissionNumber);

    const exists = await StudentModel.exists({ schoolId, admissionNumber });
    if (exists) throw ApiError.conflict('Admission number already in use');

    const doc = await StudentModel.create({
      schoolId,
      admissionNumber,
      rollNumber: payload.rollNumber ?? '',
      name: payload.name,
      fatherName: (payload.parents as Record<string, unknown> | undefined)?.fatherName ?? '',
      className,
      section,
      classKey: `${className}-${section}`,
      admissionType: payload.admissionType,
      admittedAt: new Date(String(payload.admittedAt)),
      sessionLabel: payload.sessionLabel ?? '',
      dateOfBirth: payload.dateOfBirth ?? '',
      gender: payload.gender,
      bloodGroup: payload.bloodGroup,
      religion: payload.religion,
      caste: payload.caste,
      category: payload.category,
      nationality: payload.nationality,
      aadhaar: payload.aadhaar,
      parents: payload.parents ?? {},
      currentAddress: payload.currentAddress ?? {},
      permanentAddress: payload.permanentAddress ?? {},
      permanentSameAsCurrent: payload.permanentSameAsCurrent ?? true,
      previousAcademic: payload.previousAcademic,
      documents: (payload.documents as unknown[] | undefined)?.map((d) => ({
        ...(d as Record<string, unknown>),
        uploadedAt: new Date().toISOString(),
        verification: 'pending',
      })) ?? [],
    });

    return { id: String(doc._id), admissionNumber: doc.admissionNumber };
  },

  async profile(schoolId: string, id: string) {
    const d = await StudentModel.findOne({ _id: id, schoolId }).lean();
    if (!d) throw ApiError.notFound('Student not found');
    return toProfile(d);
  },

  async bulkStatus(schoolId: string, studentIds: string[], status: string) {
    const res = await StudentModel.updateMany(
      { schoolId, _id: { $in: studentIds } },
      { profileStatus: status },
    );
    return { affected: res.matchedCount };
  },

  async bulkTransfer(schoolId: string, studentIds: string[], toClassName: string, toSection: string) {
    const res = await StudentModel.updateMany(
      { schoolId, _id: { $in: studentIds } },
      { className: toClassName, section: toSection, classKey: toClassName },
    );
    return { affected: res.matchedCount };
  },

  async bulkPromote(
    schoolId: string,
    fromClassKey: string,
    toClassName: string,
    toSection: string,
    toSession: string,
  ) {
    const res = await StudentModel.updateMany(
      { schoolId, classKey: fromClassKey },
      { className: toClassName, section: toSection, classKey: toClassName, sessionLabel: toSession },
    );
    return { affected: res.matchedCount };
  },

  // ─── Documents (embedded on the student doc) ───
  async getDocuments(schoolId: string, id: string) {
    const s = await StudentModel.findOne({ _id: id, schoolId }).lean();
    if (!s) throw ApiError.notFound('Student not found');
    const docs = (s.documents as unknown as Array<Record<string, unknown> & { _id: unknown }>) ?? [];
    return docs.map((d) => ({
      id: String(d._id),
      type: d.type,
      customLabel: d.customLabel,
      fileName: d.fileName,
      sizeBytes: d.sizeBytes,
      uploadedAt: d.uploadedAt,
      verification: d.verification ?? 'pending',
    }));
  },

  async addDocument(schoolId: string, id: string, payload: Record<string, unknown>) {
    const student = await StudentModel.findOne({ _id: id, schoolId });
    if (!student) throw ApiError.notFound('Student not found');
    const doc = {
      type: payload.type ?? 'other',
      customLabel: payload.customLabel,
      fileName: payload.fileName,
      sizeBytes: Number(payload.sizeBytes ?? 0),
      uploadedAt: new Date().toISOString(),
      verification: 'pending' as const,
    };
    (student.documents as unknown[]).push(doc);
    await student.save();
    const created = (student.documents as unknown as Array<Record<string, unknown> & { _id: unknown }>).at(-1)!;
    return {
      id: String(created._id),
      type: created.type,
      customLabel: created.customLabel,
      fileName: created.fileName,
      sizeBytes: created.sizeBytes,
      uploadedAt: created.uploadedAt,
      verification: created.verification,
    };
  },

  async deleteDocument(schoolId: string, id: string, docId: string) {
    const res = await StudentModel.updateOne({ _id: id, schoolId }, { $pull: { documents: { _id: docId } } });
    if (!res.matchedCount) throw ApiError.notFound('Student not found');
  },
};
