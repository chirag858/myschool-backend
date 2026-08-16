import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { attendanceController } from '../attendance/attendance.controller';
import { studentAttendanceQuery } from '../attendance/attendance.validation';
import { examController } from '../exams/exams.controller';
import { hostelController } from '../hostel/hostel.controller';
import { transportController } from '../transport/transport.controller';
import { authenticate, requireRole } from '../../middleware/auth';
import { upload } from '../../middleware/upload';
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

/**
 * Mounted at /api/students. Academic-admin roles by default (`adminGate`);
 * individual routes widen this where a non-admin role legitimately needs
 * read access (receptionist for admissions, teacher for their own
 * students' attendance) — those use `requireRole(...)` directly instead of
 * `adminGate`. NOTE: only one `requireRole` gate must run per route —
 * router-level `.use(requireRole(...))` would reject those wider roles
 * before a route-specific override is ever reached.
 */
export const studentsRoutes = Router();
studentsRoutes.use(authenticate);
const adminGate = requireRole(...ACADEMIC_ADMIN_ROLES);

// Admission number helpers: also allow receptionist (New Admission wizard step 0).
studentsRoutes.get(
  '/generate-number',
  requireRole('school_admin', 'principal', 'coordinator', 'receptionist'),
  asyncHandler(studentsController.generateAdmissionNumber),
);
studentsRoutes.post(
  '/check-number',
  requireRole('school_admin', 'principal', 'coordinator', 'receptionist'),
  asyncHandler(studentsController.checkAdmissionNumber),
);
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
// Also allow receptionist (Student Search, New Admission duplicate lookups).
studentsRoutes.get(
  '/',
  requireRole(...ACADEMIC_ADMIN_ROLES, 'accountant', 'receptionist'),
  validate({ query: studentsQuerySchema }),
  asyncHandler(studentsController.list),
);
studentsRoutes.post(
  '/',
  requireRole('school_admin', 'principal', 'coordinator', 'receptionist'),
  validate({ body: createStudentSchema }),
  asyncHandler(studentsController.create),
);
// Admission wizard's webcam-captured photo — same roles as create.
studentsRoutes.post(
  '/upload-photo',
  requireRole('school_admin', 'principal', 'coordinator', 'receptionist'),
  upload.single('photo'),
  asyncHandler(studentsController.uploadPhoto),
);
// Admission wizard's Documents step — same roles as create.
studentsRoutes.post(
  '/upload-document',
  requireRole('school_admin', 'principal', 'coordinator', 'receptionist'),
  upload.single('document'),
  asyncHandler(studentsController.uploadDocument),
);
studentsRoutes.get(
  '/class-summary',
  requireRole(...ACADEMIC_ADMIN_ROLES, 'accountant'),
  asyncHandler(studentsController.classSummary),
);
studentsRoutes.post('/bulk/status', adminGate, validate({ body: bulkStatusSchema }), asyncHandler(studentsController.bulkStatus));
studentsRoutes.post('/bulk/transfer', adminGate, validate({ body: bulkTransferSchema }), asyncHandler(studentsController.bulkTransfer));
studentsRoutes.post('/bulk/promote', adminGate, validate({ body: bulkPromoteSchema }), asyncHandler(studentsController.bulkPromote));
// Student attendance calendar views (Attendance domain). Also allow teacher
// (Attendance Reports > Student detail reads a real student's own history).
// Also allow receptionist — read-only Student Search profile view.
studentsRoutes.get(
  '/:id/attendance/annual-summary',
  requireRole(...ACADEMIC_ADMIN_ROLES, 'teacher', 'receptionist'),
  validate({ params: idParam }),
  asyncHandler(attendanceController.studentAnnual),
);
studentsRoutes.get(
  '/:id/attendance',
  requireRole(...ACADEMIC_ADMIN_ROLES, 'teacher', 'receptionist'),
  validate({ params: idParam, query: studentAttendanceQuery }),
  asyncHandler(attendanceController.studentMonth),
);
// Student exam results (Exams domain). Also allow receptionist (read-only profile view).
studentsRoutes.get(
  '/:id/exams',
  requireRole(...ACADEMIC_ADMIN_ROLES, 'receptionist'),
  validate({ params: idParam }),
  asyncHandler(examController.studentExams),
);
// Student academic/promotion history (embedded). Also allow receptionist (read-only profile view).
studentsRoutes.get(
  '/:id/academic-history',
  requireRole(...ACADEMIC_ADMIN_ROLES, 'receptionist'),
  validate({ params: idParam }),
  asyncHandler(studentsController.academicHistory),
);
// Student hostel allocation (Hostel domain). Also allow receptionist (read-only profile view).
studentsRoutes.get(
  '/:id/hostel',
  requireRole(...ACADEMIC_ADMIN_ROLES, 'receptionist'),
  validate({ params: idParam }),
  asyncHandler(hostelController.studentHostel),
);
// Student transport assignment (Transport domain). Also allow receptionist (read-only profile view).
studentsRoutes.get(
  '/:id/transport',
  requireRole(...ACADEMIC_ADMIN_ROLES, 'receptionist'),
  validate({ params: idParam }),
  asyncHandler(transportController.studentTransport),
);
// Student documents (embedded). Also allow receptionist (Document Collection screen).
const documentsGate = requireRole('school_admin', 'principal', 'coordinator', 'receptionist');
studentsRoutes.get('/:id/documents', documentsGate, validate({ params: idParam }), asyncHandler(studentsController.getDocuments));
studentsRoutes.post(
  '/:id/documents',
  documentsGate,
  upload.single('document'),
  validate({ params: idParam, body: documentSchema }),
  asyncHandler(studentsController.addDocument),
);
studentsRoutes.delete('/:id/documents/:docId', documentsGate, validate({ params: docIdParam }), asyncHandler(studentsController.deleteDocument));
// Also allow accountant (Fee Ledger's Profile action) and receptionist (Student Search profile link).
studentsRoutes.get(
  '/:id',
  requireRole(...ACADEMIC_ADMIN_ROLES, 'accountant', 'receptionist'),
  validate({ params: idParam }),
  asyncHandler(studentsController.profile),
);
// Parent login credentials (auto-created at student admission). Same roles
// that can create/edit a student manage the linked parent account.
studentsRoutes.get(
  '/:id/parent-credentials',
  requireRole('school_admin', 'principal', 'coordinator', 'receptionist'),
  validate({ params: idParam }),
  asyncHandler(studentsController.getParentCredentials),
);
studentsRoutes.post(
  '/:id/parent-credentials/reset',
  requireRole('school_admin', 'principal', 'coordinator', 'receptionist'),
  validate({ params: idParam }),
  asyncHandler(studentsController.resetParentCredentials),
);
