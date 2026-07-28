import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { attendanceController } from '../attendance/attendance.controller';
import { studentAttendanceQuery } from '../attendance/attendance.validation';
import { examController } from '../exams/exams.controller';
import { hostelController } from '../hostel/hostel.controller';
import { transportController } from '../transport/transport.controller';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ACADEMIC_ADMIN_ROLES } from '../user/roles';
import { studentsController } from './students.controller';
import {
  bulkPromoteSchema,
  bulkStatusSchema,
  bulkTransferSchema,
  createStudentSchema,
  docIdParam,
  documentSchema,
  idParam,
  studentsQuerySchema,
} from './students.validation';

/** Mounted at /api/students. Academic-admin roles only. */
export const studentsRoutes = Router();
studentsRoutes.use(authenticate, requireRole(...ACADEMIC_ADMIN_ROLES));

studentsRoutes.get('/generate-number', asyncHandler(studentsController.generateAdmissionNumber));
studentsRoutes.post('/check-number', asyncHandler(studentsController.checkAdmissionNumber));
// Admission helper routes: also allow receptionist (they manage the admissions page).
studentsRoutes.get(
  '/admission-stats',
  requireRole('school_admin', 'principal', 'coordinator', 'receptionist'),
  asyncHandler(studentsController.admissionStats),
);
studentsRoutes.post(
  '/check-duplicate',
  requireRole('school_admin', 'principal', 'coordinator', 'receptionist'),
  asyncHandler(studentsController.checkDuplicate),
);
studentsRoutes.post(
  '/check-mobile',
  requireRole('school_admin', 'principal', 'coordinator', 'receptionist'),
  asyncHandler(studentsController.checkMobile),
);
studentsRoutes.get('/', validate({ query: studentsQuerySchema }), asyncHandler(studentsController.list));
studentsRoutes.post('/', validate({ body: createStudentSchema }), asyncHandler(studentsController.create));
studentsRoutes.get('/class-summary', asyncHandler(studentsController.classSummary));
studentsRoutes.post('/bulk/status', validate({ body: bulkStatusSchema }), asyncHandler(studentsController.bulkStatus));
studentsRoutes.post('/bulk/transfer', validate({ body: bulkTransferSchema }), asyncHandler(studentsController.bulkTransfer));
studentsRoutes.post('/bulk/promote', validate({ body: bulkPromoteSchema }), asyncHandler(studentsController.bulkPromote));
// Student attendance calendar views (Attendance domain).
studentsRoutes.get(
  '/:id/attendance/annual-summary',
  validate({ params: idParam }),
  asyncHandler(attendanceController.studentAnnual),
);
studentsRoutes.get(
  '/:id/attendance',
  validate({ params: idParam, query: studentAttendanceQuery }),
  asyncHandler(attendanceController.studentMonth),
);
// Student exam results (Exams domain).
studentsRoutes.get('/:id/exams', validate({ params: idParam }), asyncHandler(examController.studentExams));
// Student hostel allocation (Hostel domain).
studentsRoutes.get('/:id/hostel', validate({ params: idParam }), asyncHandler(hostelController.studentHostel));
// Student transport assignment (Transport domain).
studentsRoutes.get('/:id/transport', validate({ params: idParam }), asyncHandler(transportController.studentTransport));
// Student documents (embedded).
studentsRoutes.get('/:id/documents', validate({ params: idParam }), asyncHandler(studentsController.getDocuments));
studentsRoutes.post('/:id/documents', validate({ params: idParam, body: documentSchema }), asyncHandler(studentsController.addDocument));
studentsRoutes.delete('/:id/documents/:docId', validate({ params: docIdParam }), asyncHandler(studentsController.deleteDocument));
studentsRoutes.get('/:id', validate({ params: idParam }), asyncHandler(studentsController.profile));
