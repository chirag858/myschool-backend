import { ApiError } from '../../lib/api-error';
import {
  PeriodModel,
  RoomModel,
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

  detectConflicts: (payload: AnyDoc, allTimetables: AnyDoc[]) => {
    const conflicts = [];
    for (const tt of allTimetables) {
      for (const slot of tt.slots) {
        const sameTime = slot.day === payload.day && slot.periodId === payload.periodId;
        if (!sameTime) continue;
        const sameClassSection = slot.classId === payload.classId && slot.section === payload.section;

        if (slot.teacherId === payload.teacherId && !sameClassSection) {
          conflicts.push({
            type: 'teacher_overlap',
            message: `${slot.teacherName} already teaches ${slot.subjectName} in ${slot.classId}-${slot.section}.`,
            conflictingClass: `${slot.classId}-${slot.section}`,
            conflictingTeacher: slot.teacherName,
          });
        }

        if (slot.roomId === payload.roomId && !sameClassSection) {
          conflicts.push({
            type: 'room_collision',
            message: `Room ${slot.roomName} already booked by ${slot.classId}-${slot.section}.`,
            conflictingClass: `${slot.classId}-${slot.section}`,
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
    const all = await TimetableClassModel.find({ schoolId }).lean();
    return timetableService.detectConflicts(payload, all);
  },

  saveSlot: async (schoolId: string, payload: AnyDoc) => {
    // 1. Check conflicts — exclude the slot being replaced so we don't get a false timing_overlap
    const all = await TimetableClassModel.find({ schoolId }).lean();
    const allFiltered = all.map((tt: AnyDoc) => ({
      ...tt,
      slots: (tt.classId === payload.classId && tt.section === payload.section)
        ? tt.slots.filter((s: AnyDoc) => !(s.day === payload.day && s.periodId === payload.periodId))
        : tt.slots,
    }));
    const conflicts = timetableService.detectConflicts(payload, allFiltered);
    
    // We only block on teacher or room overlaps, or timing overlaps!
    if (conflicts.length > 0) {
      // In a real strict environment we might throw, but often the UI handles warnings.
      // We will throw to enforce data integrity.
      throw new ApiError(400, 'CONFLICT', 'Conflicts detected: ' + conflicts.map((c: AnyDoc) => c.message).join(', '));
    }

    // 2. Add slot
    const tt = await timetableService.ensureTimetableClass(schoolId, payload.classId, payload.section);
    
    // Remove existing slot at this day+period for this class (cast to any[] to avoid readonly constraint)
    const filtered = (tt.slots as AnyDoc[]).filter(
      (s) => !(s.day === payload.day && s.periodId === payload.periodId)
    );
    tt.slots = filtered as typeof tt.slots;
    
    (tt.slots as AnyDoc[]).push({ ...payload });

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

  scanAllConflicts: async (schoolId: string) => {
    const items = await TimetableClassModel.find({ schoolId });
    const conflictRows = [];
    // A simplified scan looking for teacher or room overlaps across all days and periods.
    const map = new Map<string, AnyDoc[]>();
    
    for (const tt of items) {
      for (const slot of tt.slots as AnyDoc[]) {
        const key = `${slot.day}-${slot.periodId}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push({ ...(slot.toObject ? slot.toObject() : slot), classLabel: `${tt.classId}-${tt.section}` });
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
  }
};
