import { Types } from 'mongoose';

import { ClassModel, SectionModel } from '../academics/academics.models';
import { ApiError } from '../../lib/api-error';
import { assignedClassesOf } from '../coordinator/coordinator.service';
import { paginate, pageParams } from '../../lib/paginate';
import { StudentModel } from '../students/student.model';
import { UserModel } from '../user/user.model';
import { PicnicCounterModel, PicnicModel, PicnicPassModel } from './picnic.models';

type Doc = Record<string, unknown> & { _id: unknown };
const nowIso = (): string => new Date().toISOString();

function dto(d: Doc): Record<string, unknown> {
  const { _id, __v, schoolId, createdAt, updatedAt, ...rest } = d as Record<string, unknown>;
  void __v;
  void schoolId;
  void createdAt;
  void updatedAt;
  return { id: String(_id), ...rest };
}

/** Every real "ClassName-Section" combo for the school — same convention as
 * coordinator.service.ts's validClassKeys, kept local since that one isn't exported. */
async function validClassKeys(schoolId: string): Promise<Set<string>> {
  const classes = await ClassModel.find({ schoolId }).lean();
  const sections = await SectionModel.find({ schoolId }).lean();
  const classNameById = new Map(classes.map((c) => [String(c._id), c.name as string]));
  return new Set(
    sections
      .map((s) => {
        const className = classNameById.get(String(s.classId));
        return className ? `${className}-${s.name}` : null;
      })
      .filter((key): key is string => Boolean(key)),
  );
}

/** A coordinator may only build a picnic from classes assigned to them
 * (empty assignedClasses = unscoped, same convention as the rest of the app). */
async function assertClassesInScope(schoolId: string, userId: string, classKeys: string[]): Promise<void> {
  const assigned = new Set(await assignedClassesOf(userId));
  const valid = await validClassKeys(schoolId);
  const unknown = classKeys.filter((k) => !valid.has(k));
  if (unknown.length) throw ApiError.badRequest(`Unknown class/section: ${unknown.join(', ')}`);
  if (assigned.size) {
    const outOfScope = classKeys.filter((k) => !assigned.has(k));
    if (outOfScope.length) throw ApiError.forbidden(`Not your assigned class: ${outOfScope.join(', ')}`);
  }
}

async function buildParticipants(schoolId: string, classKeys: string[], studentIds: string[]) {
  const students = await StudentModel.find({
    schoolId,
    classKey: { $in: classKeys },
    _id: { $in: studentIds },
  }).lean();
  const found = new Set(students.map((s) => String(s._id)));
  const missing = studentIds.filter((id) => !found.has(id));
  if (missing.length) throw ApiError.badRequest('Some selected students are not in the selected classes');
  return students.map((s) => ({
    studentId: String(s._id),
    studentName: s.name as string,
    admissionNumber: (s.admissionNumber as string) ?? '',
    className: (s.className as string) ?? '',
    section: (s.section as string) ?? '',
  }));
}

async function nextPassNumber(schoolId: string): Promise<string> {
  const counter = await PicnicCounterModel.findOneAndUpdate(
    { schoolId, key: 'picnicPass' },
    { $inc: { value: 1 } },
    { new: true, upsert: true },
  );
  return `PIC-${new Date().getFullYear()}-${String(counter.value).padStart(4, '0')}`;
}

interface PicnicPayload {
  title: string;
  destination: string;
  date: string;
  startTime?: string;
  endTime?: string;
  description?: string;
  instructions?: string;
  classKeys: string[];
  studentIds: string[];
  pricePerStudent: number;
}

export const picnicService = {
  async getAssignedClasses(schoolId: string, userId: string) {
    const assigned = await assignedClassesOf(userId);
    const keys = assigned.length ? assigned : [...(await validClassKeys(schoolId))];
    const counts = await StudentModel.aggregate<{ _id: string; count: number }>([
      { $match: { schoolId: new Types.ObjectId(schoolId), classKey: { $in: keys }, profileStatus: 'active' } },
      { $group: { _id: '$classKey', count: { $sum: 1 } } },
    ]);
    const countByKey = new Map(counts.map((c) => [c._id, c.count]));
    return keys
      .sort()
      .map((key) => {
        const [className, section] = key.split('-');
        return { classKey: key, className: className ?? key, section: section ?? '', studentCount: countByKey.get(key) ?? 0 };
      });
  },

  async getStudentsForClasses(schoolId: string, userId: string, classKeys: string[]) {
    await assertClassesInScope(schoolId, userId, classKeys);
    const students = await StudentModel.find({ schoolId, classKey: { $in: classKeys }, profileStatus: 'active' })
      .sort({ className: 1, section: 1, rollNumber: 1, name: 1 })
      .lean();
    return students.map((s) => ({
      id: String(s._id),
      admissionNumber: (s.admissionNumber as string) ?? '',
      name: s.name as string,
      className: (s.className as string) ?? '',
      section: (s.section as string) ?? '',
      classKey: (s.classKey as string) ?? '',
    }));
  },

  async listMine(schoolId: string, userId: string, query: Record<string, string>) {
    const filter: Record<string, unknown> = { schoolId, createdBy: userId };
    if (query.status && query.status !== 'all') filter.status = query.status;
    if (query.search) {
      const rx = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ title: rx }, { destination: rx }];
    }
    const result = await paginate(PicnicModel, filter, pageParams(query), { sort: { createdAt: -1 } });
    return { ...result, items: result.items.map((d) => dto(d as unknown as Doc)) };
  },

  async listRequests(schoolId: string, query: Record<string, string>) {
    const filter: Record<string, unknown> = { schoolId, status: { $ne: 'draft' } };
    if (query.status && query.status !== 'all') filter.status = query.status;
    if (query.search) {
      const rx = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ title: rx }, { destination: rx }];
    }
    const result = await paginate(PicnicModel, filter, pageParams(query), { sort: { submittedAt: -1, createdAt: -1 } });
    return { ...result, items: result.items.map((d) => dto(d as unknown as Doc)) };
  },

  async getDetail(schoolId: string, userId: string, role: string, id: string) {
    const doc = await PicnicModel.findOne({ _id: id, schoolId }).lean();
    if (!doc) throw ApiError.notFound('Picnic not found');
    if (role === 'coordinator' && String(doc.createdBy) !== userId) throw ApiError.notFound('Picnic not found');
    // A draft is the coordinator's own working copy — gate_manager only ever
    // sees a picnic once it's been submitted, same boundary as listRequests.
    if (role === 'gate_manager' && doc.status === 'draft') throw ApiError.notFound('Picnic not found');
    const passes = doc.status === 'passes_generated'
      ? (await PicnicPassModel.find({ schoolId, picnicId: id }).sort({ studentName: 1 }).lean()).map((p) => dto(p as Doc))
      : [];
    return { ...dto(doc as Doc), passes };
  },

  async create(schoolId: string, userId: string, payload: PicnicPayload) {
    await assertClassesInScope(schoolId, userId, payload.classKeys);
    const participants = await buildParticipants(schoolId, payload.classKeys, payload.studentIds);
    const totalParticipants = participants.length;
    const totalCost = totalParticipants * payload.pricePerStudent;
    const creator = await UserModel.findById(userId).lean();
    const doc = await PicnicModel.create({
      schoolId,
      title: payload.title,
      destination: payload.destination,
      date: payload.date,
      startTime: payload.startTime ?? '',
      endTime: payload.endTime ?? '',
      description: payload.description ?? '',
      instructions: payload.instructions ?? '',
      classKeys: payload.classKeys,
      participants,
      pricePerStudent: payload.pricePerStudent,
      totalParticipants,
      totalCost,
      status: 'draft',
      createdBy: userId,
      createdByName: (creator?.name as string) ?? 'Coordinator',
    });
    return dto(doc.toObject());
  },

  async update(schoolId: string, userId: string, id: string, payload: PicnicPayload) {
    await assertClassesInScope(schoolId, userId, payload.classKeys);
    const participants = await buildParticipants(schoolId, payload.classKeys, payload.studentIds);
    const totalParticipants = participants.length;
    const totalCost = totalParticipants * payload.pricePerStudent;
    const doc = await PicnicModel.findOneAndUpdate(
      { _id: id, schoolId, createdBy: userId, status: 'draft' },
      {
        $set: {
          title: payload.title,
          destination: payload.destination,
          date: payload.date,
          startTime: payload.startTime ?? '',
          endTime: payload.endTime ?? '',
          description: payload.description ?? '',
          instructions: payload.instructions ?? '',
          classKeys: payload.classKeys,
          participants,
          pricePerStudent: payload.pricePerStudent,
          totalParticipants,
          totalCost,
        },
      },
      { new: true },
    );
    if (!doc) {
      const exists = await PicnicModel.exists({ _id: id, schoolId, createdBy: userId });
      throw exists ? ApiError.conflict('Only a draft picnic can be edited') : ApiError.notFound('Picnic not found');
    }
    return dto(doc.toObject());
  },

  async submit(schoolId: string, userId: string, id: string) {
    const draft = await PicnicModel.findOne({ _id: id, schoolId, createdBy: userId, status: 'draft' }).lean();
    if (!draft) {
      const exists = await PicnicModel.exists({ _id: id, schoolId, createdBy: userId });
      throw exists ? ApiError.conflict('This picnic has already been submitted') : ApiError.notFound('Picnic not found');
    }
    if (!draft.participants?.length) throw ApiError.badRequest('Add at least one participating student before submitting');
    const doc = await PicnicModel.findOneAndUpdate(
      { _id: id, schoolId, createdBy: userId, status: 'draft' },
      { $set: { status: 'submitted', submittedAt: nowIso() } },
      { new: true },
    );
    if (!doc) throw ApiError.conflict('This picnic has already been submitted');
    return dto(doc.toObject());
  },

  async decide(schoolId: string, gateManagerId: string, id: string, status: 'approved' | 'rejected', reason?: string) {
    const gm = await UserModel.findById(gateManagerId).lean();
    const doc = await PicnicModel.findOneAndUpdate(
      { _id: id, schoolId, status: 'submitted' },
      {
        $set: {
          status,
          decidedAt: nowIso(),
          decidedBy: gateManagerId,
          decidedByName: (gm?.name as string) ?? 'Gate Manager',
          ...(status === 'rejected' ? { rejectionReason: reason } : {}),
        },
      },
      { new: true },
    );
    if (!doc) {
      const exists = await PicnicModel.exists({ _id: id, schoolId });
      throw exists ? ApiError.conflict('This picnic has already been decided') : ApiError.notFound('Picnic not found');
    }
    return dto(doc.toObject());
  },

  async generatePasses(schoolId: string, gateManagerId: string, id: string) {
    const gm = await UserModel.findById(gateManagerId).lean();
    const gmName = (gm?.name as string) ?? 'Gate Manager';
    // Atomic status flip guards against duplicate pass generation — a retry or
    // a second click can't win this race once the first request's update lands.
    const doc = await PicnicModel.findOneAndUpdate(
      { _id: id, schoolId, status: 'approved' },
      { $set: { status: 'passes_generated', passesGeneratedAt: nowIso(), passesGeneratedBy: gateManagerId, passesGeneratedByName: gmName } },
      { new: true },
    );
    if (!doc) {
      const existing = await PicnicModel.findOne({ _id: id, schoolId }).lean();
      if (!existing) throw ApiError.notFound('Picnic not found');
      if (existing.status === 'passes_generated') throw ApiError.conflict('Passes have already been generated for this picnic');
      throw ApiError.badRequest('Only an approved picnic can have passes generated');
    }
    const passes = [];
    for (const participant of doc.participants ?? []) {
      const passNumber = await nextPassNumber(schoolId);
      const passDoc = await PicnicPassModel.create({
        schoolId,
        picnicId: doc._id,
        studentId: participant.studentId,
        studentName: participant.studentName,
        admissionNumber: participant.admissionNumber,
        className: participant.className,
        section: participant.section,
        passNumber,
        status: 'active',
        issuedAt: nowIso(),
        issuedBy: gateManagerId,
        issuedByName: gmName,
      });
      passes.push(dto(passDoc.toObject()));
    }
    return { picnic: dto(doc.toObject()), passes };
  },

  async listPasses(schoolId: string, userId: string, role: string, id: string) {
    const picnic = await PicnicModel.findOne({ _id: id, schoolId }).lean();
    if (!picnic) throw ApiError.notFound('Picnic not found');
    if (role === 'coordinator' && String(picnic.createdBy) !== userId) throw ApiError.notFound('Picnic not found');
    if (role === 'gate_manager' && picnic.status === 'draft') throw ApiError.notFound('Picnic not found');
    return (await PicnicPassModel.find({ schoolId, picnicId: id }).sort({ studentName: 1 }).lean()).map((p) => dto(p as Doc));
  },
};
