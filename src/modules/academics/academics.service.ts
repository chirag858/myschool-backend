import { ApiError } from '../../lib/api-error';
import { STAFF_ROLES } from '../user/roles';
import { UserModel } from '../user/user.model';
import { ClassModel, HolidayModel, SectionModel, SessionModel } from './academics.models';

type Doc = Record<string, unknown> & { _id: unknown };

function daysBetween(start: string, end: string): number {
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  return Math.floor((b - a) / 86400000) + 1;
}

/**
 * Single source of truth for "the active session name" — several modules
 * (fee, fee-recovery) previously duplicated this exact lookup with their own
 * hardcoded '2025-26' fallback, which could silently drift out of sync.
 * Falls back to the same default only when no school has ever activated a
 * session yet (via /admin/academics/sessions) — that's a real setup gap,
 * not something this helper can fix on its own.
 */
export async function getActiveSessionName(schoolId: string): Promise<string> {
  const s = await SessionModel.findOne({ schoolId, status: 'active' }).lean();
  return s?.name ?? '2025-26';
}

function toSession(d: Doc) {
  return {
    id: String(d._id),
    name: d.name,
    startDate: d.startDate,
    endDate: d.endDate,
    status: d.status,
    description: d.description,
    createdBy: d.createdBy,
    copiedFromSessionId: d.copiedFromSessionId,
  };
}
function toSection(d: Doc) {
  return {
    id: String(d._id),
    classId: String(d.classId),
    name: d.name,
    classTeacherName: d.classTeacherName ?? null,
    classTeacherId: d.classTeacherId ?? null,
    roomName: d.roomName ?? null,
    roomId: d.roomId ?? null,
    totalStudents: 0,
    maxCapacity: d.maxCapacity ?? 40,
  };
}
function toHoliday(d: Doc) {
  return {
    id: String(d._id),
    name: d.name,
    startDate: d.startDate,
    endDate: d.endDate,
    type: d.type,
    applicability: d.applicability,
    applicableClasses: d.applicableClasses ?? [],
    recurring: d.recurring ?? false,
    description: d.description,
  };
}

export const sessionService = {
  async list(schoolId: string) {
    const docs = await SessionModel.find({ schoolId }).sort({ startDate: -1 }).lean();
    return docs.map(toSession);
  },

  async stats(schoolId: string, id: string) {
    const s = await SessionModel.findOne({ _id: id, schoolId }).lean();
    if (!s) throw ApiError.notFound('Session not found');
    const [totalStudents, totalStaff] = await Promise.all([
      UserModel.countDocuments({ schoolId, role: 'student' }),
      UserModel.countDocuments({ schoolId, role: { $in: STAFF_ROLES } }),
    ]);
    return {
      totalStudents,
      totalStaff,
      feeStructureConfigured: false,
      timetableConfigured: false,
      resultsEntered: false,
      feesFinalized: false,
      salarySlipsGenerated: false,
      promotionCompleted: false,
    };
  },

  async create(
    schoolId: string,
    payload: { name: string; startDate: string; endDate: string; description?: string; copyFromSessionId?: string },
    createdBy: string,
  ) {
    const doc = await SessionModel.create({
      schoolId,
      name: payload.name,
      startDate: payload.startDate,
      endDate: payload.endDate,
      description: payload.description,
      copiedFromSessionId: payload.copyFromSessionId,
      status: 'upcoming',
      createdBy,
    });
    return toSession(doc.toObject());
  },

  async activate(schoolId: string, id: string) {
    const target = await SessionModel.findOne({ _id: id, schoolId });
    if (!target) throw ApiError.notFound('Session not found');
    await SessionModel.updateMany({ schoolId, status: 'active' }, { status: 'closed' });
    target.status = 'active';
    await target.save();
    return { success: true };
  },

  async close(schoolId: string, id: string) {
    const t = await SessionModel.findOne({ _id: id, schoolId });
    if (!t) throw ApiError.notFound('Session not found');
    if (t.status === 'active') {
      t.status = 'closed';
      await t.save();
    }
    return { success: true };
  },

  async archive(schoolId: string, id: string) {
    const t = await SessionModel.findOne({ _id: id, schoolId });
    if (!t) throw ApiError.notFound('Session not found');
    if (t.status === 'closed') {
      t.status = 'archived';
      await t.save();
    }
    return { success: true };
  },
};

export const classService = {
  async list(schoolId: string) {
    const classes = await ClassModel.find({ schoolId }).sort({ order: 1 }).lean();
    const counts = await SectionModel.aggregate<{ _id: unknown; count: number }>([
      { $match: { classId: { $in: classes.map((c) => c._id) } } },
      { $group: { _id: '$classId', count: { $sum: 1 } } },
    ]);
    const secMap = new Map(counts.map((c) => [String(c._id), c.count]));
    return classes.map((c) => ({
      id: String(c._id),
      name: c.name,
      order: c.order,
      totalSections: secMap.get(String(c._id)) ?? 0,
      totalStudents: 0,
    }));
  },

  async create(schoolId: string, payload: { name: string; order: number }) {
    const doc = await ClassModel.create({ schoolId, name: payload.name, order: payload.order });
    return { id: String(doc._id), name: doc.name, order: doc.order, totalSections: 0, totalStudents: 0 };
  },

  async update(schoolId: string, id: string, payload: { name?: string; order?: number }) {
    const set: Record<string, unknown> = {};
    if (payload.name !== undefined) set.name = payload.name;
    if (payload.order !== undefined) set.order = payload.order;
    const doc = await ClassModel.findOneAndUpdate({ _id: id, schoolId }, { $set: set }, { new: true });
    if (!doc) throw ApiError.notFound('Class not found');
    const totalSections = await SectionModel.countDocuments({ classId: doc._id });
    return { id: String(doc._id), name: doc.name, order: doc.order, totalSections, totalStudents: 0 };
  },

  async remove(schoolId: string, id: string): Promise<{ ok: boolean; reason?: string }> {
    const doc = await ClassModel.findOne({ _id: id, schoolId });
    if (!doc) return { ok: false, reason: 'Not found.' };
    // Students domain not built yet → enrolled count is 0.
    await SectionModel.deleteMany({ classId: doc._id });
    await doc.deleteOne();
    return { ok: true };
  },

  async reorder(schoolId: string, ids: string[]) {
    await Promise.all(ids.map((id, i) => ClassModel.updateOne({ _id: id, schoolId }, { order: i + 1 })));
    return { success: true };
  },

  async listSections(schoolId: string, classId: string) {
    const cls = await ClassModel.findOne({ _id: classId, schoolId }).lean();
    if (!cls) throw ApiError.notFound('Class not found');
    const secs = await SectionModel.find({ schoolId, classId }).sort({ name: 1 }).lean();
    return secs.map(toSection);
  },

  async createSection(
    schoolId: string,
    classId: string,
    payload: Record<string, unknown>,
  ) {
    const cls = await ClassModel.findOne({ _id: classId, schoolId }).lean();
    if (!cls) throw ApiError.notFound('Class not found');
    const doc = await SectionModel.create({ schoolId, classId, ...payload });
    return toSection(doc.toObject());
  },

  async updateSection(schoolId: string, classId: string, sectionId: string, payload: Record<string, unknown>) {
    const doc = await SectionModel.findOneAndUpdate(
      { _id: sectionId, schoolId, classId },
      { $set: payload },
      { new: true },
    );
    if (!doc) throw ApiError.notFound('Section not found');
    return toSection(doc.toObject());
  },

  async deleteSection(schoolId: string, classId: string, sectionId: string) {
    await SectionModel.deleteOne({ _id: sectionId, schoolId, classId });
    return { success: true };
  },
};

export const holidayService = {
  async list(schoolId: string, sessionId?: string) {
    const filter: Record<string, unknown> = { schoolId };
    if (sessionId) filter.sessionId = sessionId;
    const docs = await HolidayModel.find(filter).sort({ startDate: 1 }).lean();
    return docs.map(toHoliday);
  },

  async create(schoolId: string, payload: Record<string, unknown>) {
    const doc = await HolidayModel.create({ schoolId, ...payload });
    return toHoliday(doc.toObject());
  },

  async update(schoolId: string, id: string, payload: Record<string, unknown>) {
    const doc = await HolidayModel.findOneAndUpdate({ _id: id, schoolId }, { $set: payload }, { new: true });
    if (!doc) throw ApiError.notFound('Holiday not found');
    return toHoliday(doc.toObject());
  },

  async remove(schoolId: string, id: string) {
    await HolidayModel.deleteOne({ _id: id, schoolId });
    return { success: true };
  },

  async copyFromSession(schoolId: string) {
    // No historical source yet — returns the current list (no-op copy).
    return this.list(schoolId);
  },

  async workingDaysSummary(schoolId: string) {
    const active = await SessionModel.findOne({ schoolId, status: 'active' }).lean();
    if (!active) return { totalDays: 0, holidays: 0, workingDays: 0 };
    const totalDays = daysBetween(active.startDate, active.endDate);
    const hols = await HolidayModel.find({ schoolId }).lean();
    const holidayDays = hols.reduce((sum, h) => sum + daysBetween(h.startDate, h.endDate), 0);
    return { totalDays, holidays: holidayDays, workingDays: Math.max(0, totalDays - holidayDays) };
  },
};
