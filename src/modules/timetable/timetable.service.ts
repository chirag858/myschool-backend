import { ApiError } from '../../lib/api-error';
import { ClassModel } from '../academics/academics.models';
import { StaffModel } from '../staff/staff.models';
import {
  PeriodModel,
  RoomModel,
  SubjectAssignmentModel,
  SubjectModel,
  TimetableClassModel,
} from './timetable.models';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;

function toPeriod(d: AnyDoc) {
  return {
    id: String(d._id),
    order: d.order,
    name: d.name,
    startTime: d.startTime,
    endTime: d.endTime,
    type: d.type,
    applicableDays: d.applicableDays,
  };
}

function toSubject(d: AnyDoc) {
  return {
    id: String(d._id),
    name: d.name,
    code: d.code,
    type: d.type,
    applicableClasses: d.applicableClasses,
    maxWeeklyPeriods: d.maxWeeklyPeriods,
    color: d.color,
  };
}

function toRoom(d: AnyDoc) {
  return {
    id: String(d._id),
    name: d.name,
    type: d.type,
    capacity: d.capacity,
    floor: d.floor,
    facilities: d.facilities,
    status: d.status,
  };
}

function toTimetableClass(d: AnyDoc) {
  const obj = typeof d.toObject === 'function' ? d.toObject() : d;
  return {
    classId: obj.classId,
    section: obj.section,
    slots: (obj.slots as AnyDoc[]).map((s) => ({
      id: String(s._id || s.id),
      classId: s.classId,
      section: s.section,
      day: s.day,
      periodId: s.periodId,
      subjectId: s.subjectId,
      subjectName: s.subjectName,
      subjectColor: s.subjectColor,
      teacherId: s.teacherId,
      teacherName: s.teacherName,
      roomId: s.roomId,
      roomName: s.roomName,
    })),
    published: obj.published,
  };
}

/** `TimetableClass.classId` stores the raw academics `Class` id — resolve it
 * to a human label ("Class 1-A") for conflict messages instead of leaking
 * the Mongo id. */
async function classLabels(schoolId: string): Promise<Map<string, string>> {
  const classes = await ClassModel.find({ schoolId }, { name: 1 }).lean();
  return new Map(classes.map((c) => [String(c._id), c.name]));
}

/** Weekly period count per teacherId, from actual scheduled timetable slots. */
async function teacherWeeklyLoads(schoolId: string): Promise<Map<string, number>> {
  const items = await TimetableClassModel.find({ schoolId }, { slots: 1 }).lean();
  const loads = new Map<string, number>();
  for (const tt of items) {
    for (const slot of (tt.slots as AnyDoc[]) ?? []) {
      loads.set(slot.teacherId, (loads.get(slot.teacherId) ?? 0) + 1);
    }
  }
  return loads;
}

export const timetableService = {
  // ── Periods ───────────────────────────────────────────────────────
  getPeriods: async (schoolId: string) => {
    const items = await PeriodModel.find({ schoolId }).sort({ order: 1 }).lean();
    return items.map(toPeriod);
  },

  savePeriods: async (schoolId: string, periods: AnyDoc[]) => {
    // Delete existing and insert new ones to handle order and deletions simply
    await PeriodModel.deleteMany({ schoolId });
    const docs = periods.map((p) => ({ ...p, schoolId }));
    await PeriodModel.insertMany(docs);
  },

  // ── Subjects ──────────────────────────────────────────────────────
  getSubjects: async (schoolId: string) => {
    const items = await SubjectModel.find({ schoolId }).sort({ name: 1 }).lean();
    return items.map(toSubject);
  },

  createSubject: async (schoolId: string, payload: AnyDoc) => {
    const created = await SubjectModel.create({ schoolId, ...payload });
    return toSubject(created.toObject());
  },

  updateSubject: async (schoolId: string, id: string, payload: AnyDoc) => {
    const updated = await SubjectModel.findOneAndUpdate({ _id: id, schoolId }, payload, { new: true }).lean();
    if (!updated) throw new ApiError(404, 'NOT_FOUND', 'Subject not found');
    return toSubject(updated);
  },

  deleteSubject: async (schoolId: string, id: string) => {
    const deleted = await SubjectModel.findOneAndDelete({ _id: id, schoolId }).lean();
    if (!deleted) throw new ApiError(404, 'NOT_FOUND', 'Subject not found');
  },

  // ── Rooms ─────────────────────────────────────────────────────────
  getRooms: async (schoolId: string) => {
    const items = await RoomModel.find({ schoolId }).sort({ name: 1 }).lean();
    return items.map(toRoom);
  },

  createRoom: async (schoolId: string, payload: AnyDoc) => {
    const created = await RoomModel.create({ schoolId, ...payload });
    return toRoom(created.toObject());
  },

  updateRoom: async (schoolId: string, id: string, payload: AnyDoc) => {
    const updated = await RoomModel.findOneAndUpdate({ _id: id, schoolId }, payload, { new: true }).lean();
    if (!updated) throw new ApiError(404, 'NOT_FOUND', 'Room not found');
    return toRoom(updated);
  },

  deleteRoom: async (schoolId: string, id: string) => {
    const deleted = await RoomModel.findOneAndDelete({ _id: id, schoolId }).lean();
    if (!deleted) throw new ApiError(404, 'NOT_FOUND', 'Room not found');
  },

  // ── Timetable Logic ───────────────────────────────────────────────
  ensureTimetableClass: async (schoolId: string, classId: string, section: string) => {
    let tt = await TimetableClassModel.findOne({ schoolId, classId, section });
    if (!tt) {
      tt = await TimetableClassModel.create({ schoolId, classId, section, slots: [], published: false });
    }
    return tt;
  },

  getTimetable: async (schoolId: string, classId: string, section: string) => {
    const tt = await timetableService.ensureTimetableClass(schoolId, classId, section);
    return toTimetableClass(tt);
  },

  detectConflicts: (payload: AnyDoc, allTimetables: AnyDoc[], classNameById: Map<string, string> = new Map()) => {
    const labelFor = (classId: string, section: string): string => `${classNameById.get(classId) ?? classId}-${section}`;
    const conflicts = [];
    for (const tt of allTimetables) {
      for (const slot of tt.slots) {
        const sameTime = slot.day === payload.day && slot.periodId === payload.periodId;
        if (!sameTime) continue;
        const sameClassSection = slot.classId === payload.classId && slot.section === payload.section;

        if (slot.teacherId === payload.teacherId && !sameClassSection) {
          conflicts.push({
            type: 'teacher_overlap',
            message: `${slot.teacherName} already teaches ${slot.subjectName} in ${labelFor(slot.classId, slot.section)}.`,
            conflictingClass: labelFor(slot.classId, slot.section),
            conflictingTeacher: slot.teacherName,
          });
        }

        if (slot.roomId === payload.roomId && !sameClassSection) {
          conflicts.push({
            type: 'room_collision',
            message: `Room ${slot.roomName} already booked by ${labelFor(slot.classId, slot.section)}.`,
            conflictingClass: labelFor(slot.classId, slot.section),
            conflictingRoom: slot.roomName,
          });
        }

        if (sameClassSection) {
          conflicts.push({
            type: 'timing_overlap',
            message: `This class already has ${slot.subjectName} scheduled at this time.`,
          });
        }
      }
    }
    return conflicts;
  },

  checkConflicts: async (schoolId: string, payload: AnyDoc) => {
    const [all, labels] = await Promise.all([TimetableClassModel.find({ schoolId }).lean(), classLabels(schoolId)]);
    return timetableService.detectConflicts(payload, all, labels);
  },

  saveSlot: async (schoolId: string, payload: AnyDoc) => {
    const { overridden, ...slotPayload } = payload;

    // 1. Check conflicts — exclude the slot being replaced so we don't get a false timing_overlap
    const [all, labels] = await Promise.all([TimetableClassModel.find({ schoolId }).lean(), classLabels(schoolId)]);
    const allFiltered = all.map((tt: AnyDoc) => ({
      ...tt,
      slots: (tt.classId === slotPayload.classId && tt.section === slotPayload.section)
        ? tt.slots.filter((s: AnyDoc) => !(s.day === slotPayload.day && s.periodId === slotPayload.periodId))
        : tt.slots,
    }));
    const conflicts = timetableService.detectConflicts(slotPayload, allFiltered, labels);

    // Teacher/room/timing overlaps block the save unless the caller explicitly
    // confirmed the override (the "I confirm I want to override this conflict"
    // checkbox in the assign-slot modal).
    if (conflicts.length > 0 && !overridden) {
      throw new ApiError(400, 'CONFLICT', 'Conflicts detected: ' + conflicts.map((c: AnyDoc) => c.message).join(', '));
    }

    // 2. Add slot
    const tt = await timetableService.ensureTimetableClass(schoolId, slotPayload.classId, slotPayload.section);

    // Remove existing slot at this day+period for this class (cast to any[] to avoid readonly constraint)
    const filtered = (tt.slots as AnyDoc[]).filter(
      (s) => !(s.day === slotPayload.day && s.periodId === slotPayload.periodId)
    );
    tt.slots = filtered as typeof tt.slots;

    (tt.slots as AnyDoc[]).push({ ...slotPayload });

    await tt.save();
    
    // Find the newly added slot to return
    const newSlot = (tt.slots as AnyDoc[]).find((s) => s.day === payload.day && s.periodId === payload.periodId);
    return { ...(newSlot?.toObject ? newSlot.toObject() : newSlot), id: String(newSlot?._id) };
  },

  clearSlot: async (schoolId: string, classId: string, section: string, day: string, periodId: string) => {
    const tt = await timetableService.ensureTimetableClass(schoolId, classId, section);
    const filtered = (tt.slots as AnyDoc[]).filter(
      (s) => !(s.day === day && s.periodId === periodId)
    );
    tt.slots = filtered as typeof tt.slots;
    await tt.save();
  },

  togglePublish: async (schoolId: string, classId: string, section: string, publish: boolean) => {
    const tt = await timetableService.ensureTimetableClass(schoolId, classId, section);
    tt.published = publish;
    await tt.save();
  },

  copyDay: async (schoolId: string, classId: string, section: string, fromDay: string, toDays: string[]) => {
    const tt = await timetableService.ensureTimetableClass(schoolId, classId, section);
    const fromSlots = (tt.slots as AnyDoc[]).filter((s) => s.day === fromDay).map((s) => (s.toObject ? s.toObject() : { ...s }));
    
    const remaining = (tt.slots as AnyDoc[]).filter((s) => !toDays.includes(s.day as string));
    const copies = toDays.flatMap((d) =>
      fromSlots.map((s: AnyDoc) => {
        const copy = { ...s, day: d };
        delete copy._id;
        delete copy.id;
        return copy;
      })
    );
    
    tt.slots = [...remaining, ...copies] as typeof tt.slots;
    await tt.save();
  },

  getMasterTimetable: async (schoolId: string) => {
    const items = await TimetableClassModel.find({ schoolId }).sort({ classId: 1, section: 1 });
    return items.map((d) => toTimetableClass(d));
  },

  getTeacherSchedule: async (schoolId: string, teacherId: string) => {
    const items = await TimetableClassModel.find({ schoolId });
    const slots = [];
    for (const tt of items) {
      for (const slot of tt.slots as AnyDoc[]) {
        if (slot.teacherId === teacherId) {
          slots.push({
            id: String(slot._id),
            classId: slot.classId,
            section: slot.section,
            day: slot.day,
            periodId: slot.periodId,
            subjectId: slot.subjectId,
            subjectName: slot.subjectName,
            subjectColor: slot.subjectColor,
            teacherId: slot.teacherId,
            teacherName: slot.teacherName,
            roomId: slot.roomId,
            roomName: slot.roomName,
          });
        }
      }
    }
    return slots;
  },

  /** Timetable slots store `teacherId` as the Staff `_id` (see `getTeachers`
   * in the frontend, sourced from `/staff`), not the login User `_id` — so a
   * logged-in teacher's own schedule has to go through the Staff record
   * their login is linked to (`Staff.userId`), not `req.user._id` directly. */
  getMySchedule: async (schoolId: string, userId: string) => {
    const staff = await StaffModel.findOne({ schoolId, userId }).lean();
    if (!staff) return [];
    return timetableService.getTeacherSchedule(schoolId, String(staff._id));
  },

  /** The single source of truth for "which classes/subjects does this
   * teacher actually teach" — derived from real timetable slots instead of
   * a separately hand-maintained assignment list, so it can never drift out
   * of sync with what the timetable itself says. Shape matches the old
   * `TeacherClassAssignment` rows this replaces: one entry per class the
   * teacher has at least one period in, with every subject they teach
   * there. */
  getMyTeachingAssignments: async (
    schoolId: string,
    userId: string,
  ): Promise<Array<{ className: string; section: string; subjects: string[] }>> => {
    const [slots, labels] = await Promise.all([
      timetableService.getMySchedule(schoolId, userId),
      classLabels(schoolId),
    ]);
    const byClass = new Map<string, { className: string; section: string; subjects: Set<string> }>();
    for (const s of slots) {
      const className = labels.get(s.classId) ?? s.classId;
      const key = `${className}-${s.section}`;
      const entry = byClass.get(key) ?? { className, section: s.section, subjects: new Set<string>() };
      entry.subjects.add(s.subjectName);
      byClass.set(key, entry);
    }
    return Array.from(byClass.values()).map((e) => ({
      className: e.className,
      section: e.section,
      subjects: Array.from(e.subjects),
    }));
  },

  /** School-wide version of `getMyTeachingAssignments`, one row set per
   * teacher — used by the coordinator's marks-entry overview instead of the
   * old `TeacherClassAssignment` collection, for the same reason. */
  getAllTeachingAssignments: async (
    schoolId: string,
  ): Promise<Array<{ teacherUserId: string; className: string; section: string; subjects: string[] }>> => {
    const [items, labels, staff] = await Promise.all([
      TimetableClassModel.find({ schoolId }).lean(),
      classLabels(schoolId),
      StaffModel.find({ schoolId, userId: { $ne: null } }, { userId: 1 }).lean(),
    ]);
    const userIdByStaffId = new Map(staff.map((s) => [String(s._id), String(s.userId)]));
    const byKey = new Map<
      string,
      { teacherUserId: string; className: string; section: string; subjects: Set<string> }
    >();
    for (const tt of items) {
      for (const slot of tt.slots as AnyDoc[]) {
        const teacherUserId = userIdByStaffId.get(String(slot.teacherId));
        if (!teacherUserId) continue;
        const className = labels.get(slot.classId) ?? slot.classId;
        const key = `${teacherUserId}:${className}-${slot.section}`;
        const entry = byKey.get(key) ?? { teacherUserId, className, section: slot.section, subjects: new Set<string>() };
        entry.subjects.add(slot.subjectName);
        byKey.set(key, entry);
      }
    }
    return Array.from(byKey.values()).map((e) => ({
      teacherUserId: e.teacherUserId,
      className: e.className,
      section: e.section,
      subjects: Array.from(e.subjects),
    }));
  },

  scanAllConflicts: async (schoolId: string) => {
    const [items, labels] = await Promise.all([TimetableClassModel.find({ schoolId }), classLabels(schoolId)]);
    const conflictRows = [];
    // A simplified scan looking for teacher or room overlaps across all days and periods.
    const map = new Map<string, AnyDoc[]>();

    for (const tt of items) {
      for (const slot of tt.slots as AnyDoc[]) {
        const key = `${slot.day}-${slot.periodId}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push({
          ...(slot.toObject ? slot.toObject() : slot),
          classLabel: `${labels.get(tt.classId) ?? tt.classId}-${tt.section}`,
        });
      }
    }

    for (const [, slots] of map.entries()) {
      for (let i = 0; i < slots.length; i++) {
        for (let j = i + 1; j < slots.length; j++) {
          const s1 = slots[i];
          const s2 = slots[j];
          if (s1.teacherId === s2.teacherId) {
            conflictRows.push({
              id: `${s1._id}-${s2._id}`,
              type: 'teacher_overlap',
              affectedClass: `${s1.classLabel}, ${s2.classLabel}`,
              period: s1.periodId,
              day: s1.day,
              details: `${s1.teacherName} is double-booked.`,
            });
          }
          if (s1.roomId === s2.roomId) {
            conflictRows.push({
              id: `room-${s1._id}-${s2._id}`,
              type: 'room_collision',
              affectedClass: `${s1.classLabel}, ${s2.classLabel}`,
              period: s1.periodId,
              day: s1.day,
              details: `Room ${s1.roomName} is double-booked.`,
            });
          }
        }
      }
    }
    
    return conflictRows;
  },

  // ── Teacher load ──────────────────────────────────────────────────
  getTeacherLoads: async (schoolId: string) => {
    const loads = await teacherWeeklyLoads(schoolId);
    return Object.fromEntries(loads);
  },

  // ── Subject-Teacher Assignment ───────────────────────────────────
  getSubjectAssignments: async (schoolId: string, classId: string, section: string) => {
    const [subjects, assignments, loads] = await Promise.all([
      SubjectModel.find({ schoolId }).sort({ name: 1 }).lean(),
      SubjectAssignmentModel.find({ schoolId, classId, section }).lean(),
      teacherWeeklyLoads(schoolId),
    ]);
    const applicable = subjects.filter(
      (s) => s.applicableClasses === 'all' || (s.applicableClasses as string[])?.includes(classId),
    );
    const byId = new Map(assignments.map((a) => [a.subjectId, a]));
    const teacherIds = assignments.map((a) => a.teacherId).filter((id): id is string => Boolean(id));
    const teachers = await StaffModel.find({ _id: { $in: teacherIds } }, { name: 1 }).lean();
    const teacherNameById = new Map(teachers.map((t) => [String(t._id), t.name]));

    return applicable.map((s) => {
      const a = byId.get(String(s._id));
      const teacherId = a?.teacherId ?? null;
      return {
        subjectId: String(s._id),
        subjectName: s.name,
        subjectCode: s.code,
        subjectType: s.type,
        teacherId,
        teacherName: teacherId ? (teacherNameById.get(teacherId) ?? null) : null,
        teacherWeeklyLoad: teacherId ? (loads.get(teacherId) ?? 0) : 0,
        periodsPerWeek: s.maxWeeklyPeriods,
      };
    });
  },

  saveSubjectAssignments: async (
    schoolId: string,
    classId: string,
    section: string,
    rows: Array<{ subjectId: string; teacherId: string | null }>,
  ) => {
    await Promise.all(
      rows.map((r) =>
        SubjectAssignmentModel.updateOne(
          { schoolId, classId, section, subjectId: r.subjectId },
          { $set: { teacherId: r.teacherId } },
          { upsert: true },
        ),
      ),
    );
    return { success: true };
  },

  autoAssignSubjects: async (schoolId: string, classId: string, section: string) => {
    const [current, loads, teachingStaff] = await Promise.all([
      timetableService.getSubjectAssignments(schoolId, classId, section),
      teacherWeeklyLoads(schoolId),
      StaffModel.find({ schoolId, category: 'teaching' }, { name: 1 }).lean(),
    ]);
    // Least-loaded-first: each auto-assignment nudges that teacher's running
    // count so a single teacher doesn't get every unassigned subject.
    const runningLoad = new Map(teachingStaff.map((t) => [String(t._id), loads.get(String(t._id)) ?? 0]));
    const rows = current.map((row) => {
      if (row.teacherId) return { subjectId: row.subjectId, teacherId: row.teacherId };
      let pick: string | null = null;
      let min = Infinity;
      for (const [id, load] of runningLoad) {
        if (load < min) {
          min = load;
          pick = id;
        }
      }
      if (pick) runningLoad.set(pick, min + 1);
      return { subjectId: row.subjectId, teacherId: pick };
    });
    await timetableService.saveSubjectAssignments(schoolId, classId, section, rows);
    return timetableService.getSubjectAssignments(schoolId, classId, section);
  },
};
