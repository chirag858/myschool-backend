import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ACADEMIC_ADMIN_ROLES } from '../user/roles';
import { timetableController } from './timetable.controller';
import {
  clearSlotSchema,
  copyDaySchema,
  createRoomSchema,
  createSubjectSchema,
  idParam,
  saveSubjectAssignmentsSchema,
  savePeriodsSchema,
  saveSlotSchema,
  slotCheckSchema,
  subjectAssignmentQuery,
  togglePublishSchema,
  updateRoomSchema,
  updateSubjectSchema,
} from './timetable.validation';

export const timetableRoutes = Router();

const editGate = [authenticate, requireRole(...ACADEMIC_ADMIN_ROLES)];
const readGate = [authenticate];

// ── Periods ───────────────────────────────────────────────────────
timetableRoutes.get('/config/periods', ...readGate, asyncHandler(timetableController.getPeriods));
timetableRoutes.post('/config/periods/save', ...editGate, validate({ body: savePeriodsSchema }), asyncHandler(timetableController.savePeriods));

// ── Subjects ──────────────────────────────────────────────────────
timetableRoutes.get('/config/subjects', ...readGate, asyncHandler(timetableController.getSubjects));
timetableRoutes.post('/config/subjects', ...editGate, validate({ body: createSubjectSchema }), asyncHandler(timetableController.createSubject));
timetableRoutes.put('/config/subjects/:id', ...editGate, validate({ params: idParam, body: updateSubjectSchema }), asyncHandler(timetableController.updateSubject));
timetableRoutes.delete('/config/subjects/:id', ...editGate, validate({ params: idParam }), asyncHandler(timetableController.deleteSubject));

// ── Rooms ─────────────────────────────────────────────────────────
timetableRoutes.get('/config/rooms', ...readGate, asyncHandler(timetableController.getRooms));
timetableRoutes.post('/config/rooms', ...editGate, validate({ body: createRoomSchema }), asyncHandler(timetableController.createRoom));
timetableRoutes.put('/config/rooms/:id', ...editGate, validate({ params: idParam, body: updateRoomSchema }), asyncHandler(timetableController.updateRoom));
timetableRoutes.delete('/config/rooms/:id', ...editGate, validate({ params: idParam }), asyncHandler(timetableController.deleteRoom));

// ── Timetable Core Logic ──────────────────────────────────────────
// Scan & Master
timetableRoutes.post('/scan-conflicts', ...readGate, asyncHandler(timetableController.scanAllConflicts));
timetableRoutes.get('/master', ...readGate, asyncHandler(timetableController.getMasterTimetable));

// Check/Copy/Save
timetableRoutes.post('/check-conflicts', ...editGate, validate({ body: slotCheckSchema }), asyncHandler(timetableController.checkConflicts));
timetableRoutes.post('/copy-day', ...editGate, validate({ body: copyDaySchema }), asyncHandler(timetableController.copyDay));

// Teacher load + subject assignment (static — must stay above the /:classId catch-all)
timetableRoutes.get('/teacher-loads', ...readGate, asyncHandler(timetableController.getTeacherLoads));
timetableRoutes.get('/teachers', ...readGate, asyncHandler(timetableController.getTeachersList));
timetableRoutes.get(
  '/subject-assignments',
  ...readGate,
  validate({ query: subjectAssignmentQuery }),
  asyncHandler(timetableController.getSubjectAssignments),
);
timetableRoutes.post(
  '/subject-assignments',
  ...editGate,
  validate({ body: saveSubjectAssignmentsSchema }),
  asyncHandler(timetableController.saveSubjectAssignments),
);
timetableRoutes.post(
  '/subject-assignments/auto-assign',
  ...editGate,
  validate({ body: subjectAssignmentQuery }),
  asyncHandler(timetableController.autoAssignSubjects),
);

// Specific class endpoints (Note: these should not conflict with above static routes, so they use /class or /slot namespaces or specific HTTP methods where possible)
timetableRoutes.get('/my-schedule', ...readGate, asyncHandler(timetableController.getMySchedule));
timetableRoutes.get('/teacher/:staffId', ...readGate, asyncHandler(timetableController.getTeacherSchedule));

// `/:classId` is a catch-all single-segment param — every literal route above
// (my-schedule, teacher/:staffId, config/*, subject-assignments/*, master,
// scan-conflicts, teacher-loads) must stay mounted before this line.
timetableRoutes.get('/:classId', ...readGate, asyncHandler(timetableController.getTimetable));
timetableRoutes.post('/:classId/save', ...editGate, validate({ body: saveSlotSchema }), asyncHandler(timetableController.saveSlot));
timetableRoutes.delete('/:classId/slots/:slotId', ...editGate, validate({ body: clearSlotSchema }), asyncHandler(timetableController.clearSlot));
timetableRoutes.patch('/:classId/publish', ...editGate, validate({ body: togglePublishSchema }), asyncHandler(timetableController.togglePublish));
