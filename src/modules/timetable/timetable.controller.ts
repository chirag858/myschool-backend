import type { Request, Response } from 'express';

import { ClassModel } from '../academics/academics.models';
import { ApiError } from '../../lib/api-error';
import { assignedClassesOf } from '../coordinator/coordinator.service';
import { timetableService } from './timetable.service';

/**
 * A coordinator with a non-empty assignedClasses may only create/edit slots,
 * copy days, publish, or reassign subject-teachers for their own supervised
 * classes — empty means unscoped (whole school), same convention as
 * coordinator.service.ts. school_admin/principal stay unrestricted.
 */
async function assertCoordinatorClassAccess(req: Request, classId: string, section: string): Promise<void> {
  if (req.user?.role !== 'coordinator') return;
  const allowed = await assignedClassesOf(String(req.user._id));
  if (!allowed.length) return;
  const cls = await ClassModel.findOne({ _id: classId, schoolId: req.user.schoolId }).lean();
  const classKey = `${cls?.name ?? ''}-${section}`;
  if (!allowed.includes(classKey)) {
    throw ApiError.forbidden('You can only manage timetable for your assigned classes');
  }
}

export const timetableController = {
  // ── Periods ───────────────────────────────────────────────────────
  getPeriods: async (req: Request, res: Response) => {
    const periods = await timetableService.getPeriods(req.user!.schoolId!);
    res.json(periods);
  },
  savePeriods: async (req: Request, res: Response) => {
    await timetableService.savePeriods(req.user!.schoolId!, req.body.periods);
    res.json({ success: true });
  },

  // ── Subjects ──────────────────────────────────────────────────────
  getSubjects: async (req: Request, res: Response) => {
    const items = await timetableService.getSubjects(req.user!.schoolId!);
    res.json(items);
  },
  createSubject: async (req: Request, res: Response) => {
    const item = await timetableService.createSubject(req.user!.schoolId!, req.body);
    res.status(201).json(item);
  },
  updateSubject: async (req: Request, res: Response) => {
    const item = await timetableService.updateSubject(req.user!.schoolId!, req.params['id'] as string, req.body);
    res.json(item);
  },
  deleteSubject: async (req: Request, res: Response) => {
    await timetableService.deleteSubject(req.user!.schoolId!, req.params['id'] as string);
    res.json({ success: true });
  },

  // ── Rooms ─────────────────────────────────────────────────────────
  getRooms: async (req: Request, res: Response) => {
    const items = await timetableService.getRooms(req.user!.schoolId!);
    res.json(items);
  },
  createRoom: async (req: Request, res: Response) => {
    const item = await timetableService.createRoom(req.user!.schoolId!, req.body);
    res.status(201).json(item);
  },
  updateRoom: async (req: Request, res: Response) => {
    const item = await timetableService.updateRoom(req.user!.schoolId!, req.params['id'] as string, req.body);
    res.json(item);
  },
  deleteRoom: async (req: Request, res: Response) => {
    await timetableService.deleteRoom(req.user!.schoolId!, req.params['id'] as string);
    res.json({ success: true });
  },

  // ── Timetable Logic ───────────────────────────────────────────────
  getTimetable: async (req: Request, res: Response) => {
    const classId = req.params['classId'] as string;
    const { section } = req.query;
    const tt = await timetableService.getTimetable(req.user!.schoolId!, classId, section as string);
    res.json(tt);
  },

  checkConflicts: async (req: Request, res: Response) => {
    const conflicts = await timetableService.checkConflicts(req.user!.schoolId!, req.body);
    res.json(conflicts);
  },

  saveSlot: async (req: Request, res: Response) => {
    await assertCoordinatorClassAccess(req, req.body.classId, req.body.section);
    const slot = await timetableService.saveSlot(req.user!.schoolId!, req.body);
    res.json(slot);
  },

  clearSlot: async (req: Request, res: Response) => {
    const classId = req.params['classId'] as string;
    const { section, day, periodId } = req.body;
    await assertCoordinatorClassAccess(req, classId, section);
    await timetableService.clearSlot(req.user!.schoolId!, classId, section, day, periodId);
    res.json({ success: true });
  },

  togglePublish: async (req: Request, res: Response) => {
    const classId = req.params['classId'] as string;
    const { section, publish } = req.body;
    await assertCoordinatorClassAccess(req, classId, section);
    await timetableService.togglePublish(req.user!.schoolId!, classId, section, publish);
    res.json({ success: true });
  },

  copyDay: async (req: Request, res: Response) => {
    const { classId, section, fromDay, toDays } = req.body;
    await assertCoordinatorClassAccess(req, classId, section);
    await timetableService.copyDay(req.user!.schoolId!, classId, section, fromDay, toDays);
    res.json({ success: true });
  },

  getMasterTimetable: async (req: Request, res: Response) => {
    const master = await timetableService.getMasterTimetable(req.user!.schoolId!);
    res.json(master);
  },

  getTeacherSchedule: async (req: Request, res: Response) => {
    const staffId = req.params['staffId'] as string;
    const schedule = await timetableService.getTeacherSchedule(req.user!.schoolId!, staffId);
    res.json(schedule);
  },

  getMySchedule: async (req: Request, res: Response) => {
    const schedule = await timetableService.getMySchedule(req.user!.schoolId!, req.user!._id);
    res.json(schedule);
  },

  scanAllConflicts: async (req: Request, res: Response) => {
    const conflicts = await timetableService.scanAllConflicts(req.user!.schoolId!);
    res.json(conflicts);
  },

  // ── Teacher load ──────────────────────────────────────────────────
  getTeacherLoads: async (req: Request, res: Response) => {
    const loads = await timetableService.getTeacherLoads(req.user!.schoolId!);
    res.json(loads);
  },

  // ── Subject-Teacher Assignment ───────────────────────────────────
  getSubjectAssignments: async (req: Request, res: Response) => {
    const { classId, section } = req.query as Record<string, string>;
    const rows = await timetableService.getSubjectAssignments(req.user!.schoolId!, classId, section);
    res.json(rows);
  },
  saveSubjectAssignments: async (req: Request, res: Response) => {
    const { classId, section, rows } = req.body;
    await assertCoordinatorClassAccess(req, classId, section);
    const result = await timetableService.saveSubjectAssignments(req.user!.schoolId!, classId, section, rows);
    res.json(result);
  },
  autoAssignSubjects: async (req: Request, res: Response) => {
    const { classId, section } = req.body;
    await assertCoordinatorClassAccess(req, classId, section);
    const rows = await timetableService.autoAssignSubjects(req.user!.schoolId!, classId, section);
    res.json(rows);
  },
};
