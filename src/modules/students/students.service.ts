import { randomUUID } from 'node:crypto';

import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { Types } from 'mongoose';

import { ApiError } from '../../lib/api-error';
import { UserModel } from '../user/user.model';
import { StudentModel } from './student.model';
import { createStudentSchema } from './students.validation';
import { EnquiryModel } from '../enquiries/enquiry.model';

/** Resolves the parent contact number for a student from `parents.*` first
 * (the real source of truth, always present when the student has any
 * parent contact on file), falling back to the denormalised top-level
 * `mobile` field — which is only ever set at creation time and stays blank
 * forever on students admitted before that mirroring existed, or wherever
 * it wasn't derivable. Never trust `mobile` alone. */
function parentMobileOf(student: { mobile?: string; parents?: Record<string, unknown> }): string {
  const p = student.parents ?? {};
  // First NON-BLANK number: a form that saves `fatherMobile: ''` must not hide
  // the mother's or guardian's number (`??` only skips null/undefined).
  for (const v of [p.fatherMobile, p.motherMobile, p.guardianMobile, student.mobile]) {
    const s = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
    if (s) return s;
  }
  return '';
}

/** Creates a parent login the first time a mobile number is seen for this
 * school, or links the student to an existing parent account when a
 * sibling already registered that same mobile. Never creates a duplicate
 * account per mobile+school. Returns the one-time generated password only
 * when a brand-new account was created; `linked: true` (no password) when the
 * student was attached to an existing sibling account. */
async function createOrLinkParentAccount(
  schoolId: string,
  studentName: string,
  mobile: string,
): Promise<{ parentUserId: unknown; tempPassword?: string; linked?: boolean }> {
  const existing = await UserModel.findOne({ schoolId, mobile, role: 'parent' });
  if (existing) return { parentUserId: existing._id, linked: true };

  // Usernames are unique per school. The mobile is the natural parent username,
  // but a staff login (or a parent whose mobile was later edited) may already
  // hold it — creating would then 409 and block the student. Reuse that parent
  // account if it IS one; otherwise fall back to a distinct handle. Parents can
  // still sign in by mobile either way.
  const holder = await UserModel.findOne({ schoolId, username: mobile.toLowerCase() }).lean();
  if (holder?.role === 'parent') return { parentUserId: holder._id, linked: true };
  let username = mobile;
  if (holder) {
    username = `p${mobile}`;
    if (await UserModel.exists({ schoolId, username })) username = `p${mobile}-${randomUUID().slice(0, 4)}`;
  }

  const tempPassword = randomUUID().slice(0, 10);
  const passwordHash = await bcrypt.hash(tempPassword, 10);
  const user = await UserModel.create({
    name: `Parent of ${studentName}`,
    username,
    mobile,
    role: 'parent',
    passwordHash,
    schoolId,
    active: true,
    mustChangePassword: true,
  });
  return { parentUserId: user._id, tempPassword };
}

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
    house: d.house,
    bloodGroup: d.bloodGroup,
    religion: d.religion,
    caste: d.caste,
    category: d.category,
    nationality: d.nationality,
    aadhaar: d.aadhaar,
    aparId: d.aparId,
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
      url: doc.url,
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

/**
 * Bulk-import spreadsheet columns, in template order. `key` is either a
 * top-level `createStudentSchema` field or a `parents.<field>` dotted path.
 * Keep this the single source of truth for both the downloadable template
 * and the upload parser, so they can never drift apart.
 */
const IMPORT_COLUMNS: Array<{ header: string; key: string }> = [
  { header: 'Admission Number', key: 'admissionNumber' },
  { header: 'Admission Type (new/old)', key: 'admissionType' },
  { header: 'Roll Number', key: 'rollNumber' },
  { header: 'Session', key: 'sessionLabel' },
  { header: 'Class', key: 'className' },
  { header: 'Section', key: 'section' },
  { header: 'Admission Date', key: 'admittedAt' },
  { header: 'Name', key: 'name' },
  { header: 'Gender (male/female/other)', key: 'gender' },
  { header: 'House (BLUE/GREEN/RED/YELLOW)', key: 'house' },
  { header: 'Date of Birth', key: 'dateOfBirth' },
  { header: 'Blood Group', key: 'bloodGroup' },
  { header: 'Religion', key: 'religion' },
  { header: 'Category', key: 'category' },
  { header: 'Father Name', key: 'parents.fatherName' },
  { header: 'Father Mobile', key: 'parents.fatherMobile' },
  { header: 'Mother Name', key: 'parents.motherName' },
  { header: 'Mother Mobile', key: 'parents.motherMobile' },
];

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return '';
  if (typeof value === 'object' && 'text' in (value as unknown as Record<string, unknown>)) {
    return String((value as unknown as { text: unknown }).text ?? '').trim();
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function setDeep(obj: Record<string, unknown>, path: string, value: string): void {
  const [head, ...rest] = path.split('.');
  if (rest.length === 0) {
    obj[head!] = value;
    return;
  }
  const child = (obj[head!] as Record<string, unknown> | undefined) ?? {};
  obj[head!] = child;
  setDeep(child, rest.join('.'), value);
}

/** Parses an uploaded .xlsx workbook into per-row create-student payloads,
 * validating each with the exact same `createStudentSchema` the manual
 * admission form uses — so a bulk-imported row can never slip in data the
 * single-admission flow would have rejected. Missing admission numbers are
 * auto-generated (same `ADM-<year>-<seq>` scheme as `generateAdmissionNumber`),
 * with final uniqueness still enforced by `create()`'s own retry loop at
 * commit time — this is just enough to populate a sensible preview. */
async function parseImportWorkbook(schoolId: string, buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw ApiError.badRequest('Could not read this file — upload a .xlsx workbook exported from the template.');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw ApiError.badRequest('The workbook has no sheets.');

  // Match headers ignoring a parenthetical hint ("Gender (male/female/other)"
  // → "gender") so the uploaded sheet's header row doesn't have to be byte-
  // identical to the template's, just recognisably the same column name.
  const bareHeader = (h: string): string => h.toLowerCase().split('(')[0]!.trim();
  const headerRow = sheet.getRow(1);
  const colByKey = new Map<string, number>();
  headerRow.eachCell((cell, colNumber) => {
    const text = bareHeader(cellText(cell.value));
    const match = IMPORT_COLUMNS.find((c) => bareHeader(c.header) === text);
    if (match) colByKey.set(match.key, colNumber);
  });
  if (!colByKey.has('name') || !colByKey.has('className') || !colByKey.has('section')) {
    throw ApiError.badRequest('This file is missing required columns (Name, Class, Section) — download the template and keep its header row.');
  }

  const existingNumbers = new Set(
    (await StudentModel.find({ schoolId }, { admissionNumber: 1 }).lean()).map((d) => d.admissionNumber as string),
  );
  const usedInFile = new Set<string>();
  const year = new Date().getFullYear();
  let autoSeq = existingNumbers.size + 1;
  const nextAutoNumber = (): string => {
    let candidate = `ADM-${year}-${String(autoSeq).padStart(3, '0')}`;
    while (existingNumbers.has(candidate) || usedInFile.has(candidate)) {
      autoSeq += 1;
      candidate = `ADM-${year}-${String(autoSeq).padStart(3, '0')}`;
    }
    autoSeq += 1;
    return candidate;
  };

  const rows: Array<{
    row: number;
    name?: string;
    fatherName?: string;
    className?: string;
    section?: string;
    admissionType?: string;
    mobile?: string;
    data: Record<string, unknown>;
    errors: Array<{ field: string; message: string }>;
  }> = [];

  const lastRow = sheet.actualRowCount;
  for (let r = 2; r <= lastRow; r++) {
    const row = sheet.getRow(r);
    if (row.cellCount === 0) continue;
    const raw: Record<string, unknown> = {};
    for (const [key, colNumber] of colByKey) {
      setDeep(raw, key, cellText(row.getCell(colNumber).value));
    }
    const name = cellText(row.getCell(colByKey.get('name') ?? 0).value);
    if (!name) continue; // blank row — skip silently rather than surfacing a wall of "required" errors

    raw.admissionType = ((raw.admissionType as string) || 'new').toLowerCase();
    raw.admittedAt = (raw.admittedAt as string) || new Date().toISOString().slice(0, 10);
    raw.gender = ((raw.gender as string) || '').toLowerCase();
    raw.house = ((raw.house as string) || '').toUpperCase();
    if (raw.religion) raw.religion = (raw.religion as string).toLowerCase();
    if (raw.category) raw.category = (raw.category as string).toLowerCase();
    if (!raw.admissionNumber) raw.admissionNumber = nextAutoNumber();
    usedInFile.add(raw.admissionNumber as string);

    const parsed = createStudentSchema.safeParse(raw);
    const errors: Array<{ field: string; message: string }> = [];
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({ field: issue.path.join('.') || 'row', message: issue.message });
      }
    } else if (existingNumbers.has(parsed.data.admissionNumber)) {
      errors.push({ field: 'admissionNumber', message: 'Admission number already in use' });
    }

    const parents = raw.parents as Record<string, unknown> | undefined;
    rows.push({
      row: r,
      name,
      fatherName: (parents?.fatherName as string) || undefined,
      className: (raw.className as string) || undefined,
      section: (raw.section as string) || undefined,
      admissionType: (raw.admissionType as string) || undefined,
      mobile: (parents?.fatherMobile as string) || (parents?.motherMobile as string) || undefined,
      data: { ...raw, __row: r },
      errors,
    });
  }

  const errorCount = rows.filter((r) => r.errors.length > 0).length;
  return { rows, validCount: rows.length - errorCount, errorCount };
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
    let admissionNumber = String(payload.admissionNumber);

    const exists = await StudentModel.exists({ schoolId, admissionNumber });
    if (exists) throw ApiError.conflict('Admission number already in use');

    const parents = payload.parents as Record<string, unknown> | undefined;
    const mobile = parents?.fatherMobile ?? parents?.motherMobile ?? parents?.guardianMobile ?? '';

    // The exists-check above and this insert aren't atomic — two reception
    // counters admitting at the same moment can both pass the check for the
    // same auto-generated number (generateAdmissionNumber is a plain
    // count+1, not a reserved sequence) and then race on the real unique
    // index. Rather than surface that as a raw, unhelpful "Duplicate value"
    // to whichever request loses the race, bump past it and retry — the
    // admission itself is valid, only the number needs to change.
    let doc: InstanceType<typeof StudentModel> | undefined;
    for (let attempt = 0; ; attempt++) {
      try {
        doc = await StudentModel.create({
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
          house: payload.house,
          bloodGroup: payload.bloodGroup,
          religion: payload.religion,
          caste: payload.caste,
          category: payload.category,
          nationality: payload.nationality,
          aadhaar: payload.aadhaar,
          aparId: payload.aparId,
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
        break;
      } catch (err) {
        const isDuplicateAdmissionNumber =
          (err as { code?: number })?.code === 11000 &&
          /admissionNumber/.test(JSON.stringify((err as { keyPattern?: unknown })?.keyPattern ?? ''));
        if (!isDuplicateAdmissionNumber || attempt >= 5) {
          if (isDuplicateAdmissionNumber) {
            throw ApiError.conflict('Admission number was just taken by another admission — please try again.');
          }
          throw err;
        }
        const match = /(\d+)$/.exec(admissionNumber);
        const nextSeq = match ? String(Number(match[1]) + 1).padStart(match[1]!.length, '0') : `${admissionNumber}-2`;
        admissionNumber = match ? admissionNumber.slice(0, match.index) + nextSeq : nextSeq;
      }
    }

    const created = doc!;
    let parentCredentials: { tempPassword?: string } | undefined;
    if (mobile) {
      const { parentUserId, tempPassword } = await createOrLinkParentAccount(schoolId, created.name, String(mobile));
      created.parentUserId = parentUserId as typeof created.parentUserId;
      await created.save();
      parentCredentials = tempPassword ? { tempPassword } : undefined;
    }

    return {
      id: String(created._id),
      admissionNumber: created.admissionNumber,
      ...(parentCredentials ? { parentCredentials } : {}),
    };
  },

  /**
   * Assigns/changes a student's house. Separate from a generic student-update
   * endpoint (none exists yet) — this exists specifically so legacy students
   * admitted before the House field existed can be assigned one without
   * backfilling the whole fleet, and so an existing student's house can be
   * corrected later.
   */
  async updateHouse(schoolId: string, studentId: string, house: string) {
    const doc = await StudentModel.findOneAndUpdate(
      { _id: studentId, schoolId },
      { $set: { house } },
      { new: true },
    ).lean();
    if (!doc) throw ApiError.notFound('Student not found');
    return { id: String(doc._id), house: doc.house };
  },

  async getParentCredentials(schoolId: string, studentId: string) {
    const student = await StudentModel.findOne({ _id: studentId, schoolId }).lean();
    if (!student) throw ApiError.notFound('Student not found');
    if (!student.parentUserId) return { hasLogin: false };
    const user = await UserModel.findOne({ _id: student.parentUserId, schoolId }).lean();
    if (!user) return { hasLogin: false };
    return {
      hasLogin: true,
      userId: String(user._id),
      username: user.username ?? '',
      mobile: user.mobile ?? '',
      active: user.active ?? true,
    };
  },

  async resetParentCredentials(schoolId: string, studentId: string) {
    const student = await StudentModel.findOne({ _id: studentId, schoolId }).lean();
    if (!student) throw ApiError.notFound('Student not found');

    // A link to an account that no longer exists counts as "no login" — the
    // same answer getParentCredentials gives, so Create actually creates
    // instead of 404ing on a reset of a missing user.
    const linkedUser = student.parentUserId
      ? await UserModel.exists({ _id: student.parentUserId, schoolId })
      : null;

    if (!linkedUser) {
      const mobile = parentMobileOf(student);
      if (!mobile) throw ApiError.badRequest('Student has no parent mobile number on file');
      const { parentUserId, tempPassword, linked } = await createOrLinkParentAccount(schoolId, student.name, mobile);
      await StudentModel.updateOne({ _id: studentId, schoolId }, { $set: { parentUserId, mobile } });
      return linked ? { linked: true } : { tempPassword };
    }

    const tempPassword = randomUUID().slice(0, 10);
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    await UserModel.updateOne(
      { _id: student.parentUserId, schoolId },
      { $set: { passwordHash, mustChangePassword: true } },
    );
    return { tempPassword };
  },

  async profile(schoolId: string, id: string) {
    const d = await StudentModel.findOne({ _id: id, schoolId }).lean();
    if (!d) throw ApiError.notFound('Student not found');
    return toProfile(d);
  },

  async parseImportFile(schoolId: string, buffer: Buffer) {
    return parseImportWorkbook(schoolId, buffer);
  },

  /** Creates one student per row via the exact same `create()` used by the
   * admission wizard — same parent-account creation, same admission-number
   * collision retry — so a bulk-imported student is indistinguishable from
   * one entered by hand. Rows are created sequentially: a later row's
   * auto-admission-number retry must see earlier rows' inserts to avoid
   * handing out the same number twice within one file. */
  async bulkImportCommit(schoolId: string, rows: Array<Record<string, unknown>>) {
    const results: Array<{ row: number; admissionNumber?: string; error?: string }> = [];
    let created = 0;
    for (const row of rows) {
      const rowNumber = Number(row.__row ?? 0);
      try {
        const res = await this.create(schoolId, row);
        created += 1;
        results.push({ row: rowNumber, admissionNumber: res.admissionNumber });
      } catch (err) {
        results.push({ row: rowNumber, error: err instanceof ApiError ? err.message : 'Could not create this student' });
      }
    }
    return { created, failed: results.length - created, results };
  },

  async importTemplateBuffer(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Students');
    sheet.addRow(IMPORT_COLUMNS.map((c) => c.header));
    sheet.getRow(1).font = { bold: true };
    sheet.addRow([
      '', 'new', '', '2025-26', 'Class 1', 'A', '', 'Student Name', 'male', 'BLUE',
      '2018-04-15', 'O+', 'hindu', 'general', 'Father Name', '9990000000', 'Mother Name', '',
    ]);
    sheet.columns.forEach((col) => {
      col.width = Math.max(14, ...(col.values ?? []).map((v) => String(v ?? '').length + 2));
    });
    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
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
      url: d.url,
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
      url: payload.url ?? '',
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
      url: created.url,
      uploadedAt: created.uploadedAt,
      verification: created.verification,
    };
  },

  async deleteDocument(schoolId: string, id: string, docId: string) {
    const res = await StudentModel.updateOne({ _id: id, schoolId }, { $pull: { documents: { _id: docId } } });
    if (!res.matchedCount) throw ApiError.notFound('Student not found');
  },
};
