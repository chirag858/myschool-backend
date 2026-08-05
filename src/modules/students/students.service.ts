import { Types } from 'mongoose';

import { ApiError } from '../../lib/api-error';
import { StudentModel } from './student.model';
import { EnquiryModel } from '../enquiries/enquiry.model';

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

    const conditions: Record<string, unknown>[] = [{ schoolId }];

    if (query.classKey && query.classKey !== 'all') {
      const classTrimmed = query.classKey.trim();
      const rx = new RegExp(`^${escapeRegex(classTrimmed)}(-|$)`, 'i');
      conditions.push({
        $or: [
          { className: new RegExp(`^${escapeRegex(classTrimmed)}$`, 'i') },
          { classKey: rx },
        ],
      });
    }

    if (query.section && query.section !== 'all') {
      conditions.push({ section: query.section });
    }

    if (query.admissionType && query.admissionType !== 'all') {
      conditions.push({ admissionType: query.admissionType });
    }

    if (query.profileStatus && query.profileStatus !== 'all') {
      conditions.push({ profileStatus: query.profileStatus });
    }

    if (query.feeStatus && query.feeStatus !== 'all') {
      conditions.push({ feeStatus: query.feeStatus });
    }

    if (query.search?.trim()) {
      const rx = new RegExp(escapeRegex(query.search.trim()), 'i');
      conditions.push({
        $or: [{ name: rx }, { admissionNumber: rx }, { fatherName: rx }, { mobile: rx }],
      });
    }

    if (query.fromDate || query.toDate) {
      const range: Record<string, Date> = {};
      if (query.fromDate) range.$gte = new Date(query.fromDate);
      if (query.toDate) range.$lte = new Date(query.toDate);
      conditions.push({ admittedAt: range });
    }

    const filter = conditions.length === 1 ? conditions[0] : { $and: conditions };

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
    // Group by className + section so each class-section card is unique.
    // classKey is always normalised as `${className}-${section}` — grouping on
    // both fields eliminates phantom duplicates caused by stale data where
    // bulkTransfer/bulkPromote previously wrote classKey = className only.
    const agg = await StudentModel.aggregate<{
      _id: { className: string; section: string };
      count: number;
    }>([
      { $match: { schoolId: new Types.ObjectId(schoolId) } },
      { $group: { _id: { className: '$className', section: '$section' }, count: { $sum: 1 } } },
      { $sort: { '_id.className': 1, '_id.section': 1 } },
    ]);
    return agg.map((a) => ({
      classKey: `${a._id.className}-${a._id.section}`,
      className: a._id.className,
      section: a._id.section,
      studentCount: a.count,
    }));
  },

  async generateAdmissionNumber(schoolId: string) {
    const count = await StudentModel.countDocuments({ schoolId });
    const year = new Date().getFullYear();
    let attempt = count + 1;
    let candidate = `ADM-${year}-${String(attempt).padStart(3, '0')}`;
    while (await StudentModel.exists({ schoolId, admissionNumber: candidate })) {
      attempt++;
      candidate = `ADM-${year}-${String(attempt).padStart(3, '0')}`;
    }
    return { admissionNumber: candidate };
  },

  async checkAdmissionNumber(schoolId: string, admissionNumber: string) {
    const exists = await StudentModel.exists({ schoolId, admissionNumber });
    return { taken: Boolean(exists) };
  },

  async admissionStats(schoolId: string) {
    const [total, newCount, oldCount, pendingCount] = await Promise.all([
      StudentModel.countDocuments({ schoolId }),
      StudentModel.countDocuments({ schoolId, admissionType: 'new' }),
      StudentModel.countDocuments({ schoolId, admissionType: 'old' }),
      EnquiryModel.countDocuments({
        schoolId: new Types.ObjectId(schoolId),
        status: { $in: ['new', 'contacted', 'follow_up'] },
      }),
    ]);
    return {
      totalThisSession: total,
      newStudents: newCount,
      oldStudents: oldCount,
      pendingApplications: pendingCount,
    };
  },

  async checkDuplicate(
    schoolId: string,
    payload: { name: string; dateOfBirth: string; fatherName?: string },
  ) {
    if (!payload.name || !payload.dateOfBirth) return null;

    const filter: Record<string, unknown> = {
      schoolId,
      name: new RegExp(escapeRegex(payload.name.trim()), 'i'),
    };

    // Only filter by DOB if it is a non-empty value
    if (payload.dateOfBirth) {
      filter.dateOfBirth = payload.dateOfBirth;
    }

    const doc = await StudentModel.findOne(filter)
      .select('_id name className section admissionNumber')
      .lean();

    if (!doc) return null;
    return {
      studentId: String(doc._id),
      studentName: doc.name as string,
      className: `${doc.className ?? ''}-${doc.section ?? ''}`,
      admissionNumber: doc.admissionNumber as string,
    };
  },

  async checkMobile(schoolId: string, mobile: string) {
    if (!mobile || mobile.length < 7) return null;

    // Normalise: keep last 10 digits for flexible matching
    const digits = mobile.replace(/\D/g, '').slice(-10);
    const rx = new RegExp(`${digits}$`);

    const doc = await StudentModel.findOne({
      schoolId,
      $or: [
        { 'parents.fatherMobile': { $regex: rx } },
        { 'parents.motherMobile': { $regex: rx } },
      ],
    })
      .select('_id name className section')
      .lean();

    if (!doc) return null;
    return {
      parentId: String(doc._id),
      studentId: String(doc._id),
      studentName: doc.name as string,
      className: `${doc.className ?? ''}-${doc.section ?? ''}`,
    };
  },

  async create(schoolId: string, payload: Record<string, unknown>) {
    const className = String(payload.className);
    const section = String(payload.section);
    const admissionNumber = String(payload.admissionNumber);

    const exists = await StudentModel.exists({ schoolId, admissionNumber });
    if (exists) throw ApiError.conflict('Admission number already in use');

    const parents = payload.parents as Record<string, unknown> | undefined;
    const mobile = parents?.fatherMobile ?? parents?.motherMobile ?? parents?.guardianMobile ?? '';

    const doc = await StudentModel.create({
      schoolId,
      admissionNumber,
      rollNumber: payload.rollNumber ?? '',
      name: payload.name,
      photoUrl: payload.photoUrl,
      fatherName: parents?.fatherName ?? '',
      mobile,
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
    // classKey must always be `${className}-${section}` — same format as `create`.
    const res = await StudentModel.updateMany(
      { schoolId, _id: { $in: studentIds } },
      { className: toClassName, section: toSection, classKey: `${toClassName}-${toSection}` },
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
    // fromClassKey may be a single section ("Nursery-A") or a bare class name
    // ("Nursery", every section) — same dual convention the students list
    // filter and exam class-scoping already use.
    const matchFrom = { schoolId, $or: [{ classKey: fromClassKey }, { className: fromClassKey }] };

    // Capture pre-promotion state as a real history entry before overwriting.
    const outgoing = await StudentModel.find(matchFrom).lean();
    await Promise.all(
      outgoing.map((s) =>
        StudentModel.updateOne(
          { _id: s._id },
          {
            $push: {
              academicHistory: {
                sessionLabel: s.sessionLabel ?? '',
                className: s.className ?? '',
                section: s.section ?? '',
                rollNumber: s.rollNumber ?? '',
                result: 'promoted',
              },
            },
          },
        ),
      ),
    );

    // classKey must always be `${className}-${section}` — same format as `create`.
    const res = await StudentModel.updateMany(matchFrom, {
      className: toClassName,
      section: toSection,
      classKey: `${toClassName}-${toSection}`,
      sessionLabel: toSession,
    });
    return { affected: res.matchedCount };
  },

  async academicHistory(schoolId: string, id: string) {
    const s = await StudentModel.findOne({ _id: id, schoolId }).lean();
    if (!s) throw ApiError.notFound('Student not found');
    const rows = (s.academicHistory as unknown as Array<Record<string, unknown>> | undefined) ?? [];
    return rows
      .slice()
      .reverse()
      .map((r) => ({
        session: r.sessionLabel,
        className: r.className,
        section: r.section,
        rollNumber: r.rollNumber,
        result: r.result,
        remarks: r.remarks,
      }));
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
