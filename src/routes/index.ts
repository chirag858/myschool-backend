import { Router } from 'express';

import { classRoutes, holidayRoutes, sessionRoutes } from '../modules/academics/academics.routes';
import { timetableRoutes } from '../modules/timetable/timetable.routes';
import { attendanceRoutes } from '../modules/attendance/attendance.routes';
import { authRoutes } from '../modules/auth/auth.routes';
import { coordinatorRoutes } from '../modules/coordinator/coordinator.routes';
import {
  announcementRoutes,
  circularRoutes,
  communicationRoutes,
  notificationRoutes,
} from '../modules/communication/communication.routes';
import { messagingRoutes } from '../modules/communication/messaging.routes';
import { examRoutes } from '../modules/exams/exams.routes';
import { examsProgressRoutes } from '../modules/exams/exams-progress.routes';
import { gateManagerRoutes } from '../modules/gate-manager/gate-manager.routes';
import { feeRoutes } from '../modules/fee/fee.routes';
import { feeExtrasRoutes } from '../modules/fee/fee-extras.routes';
import { feeAdjustRoutes } from '../modules/fee/fee-adjust.routes';
import { feeRefundsRoutes } from '../modules/fee/fee-refunds.routes';
import { feeRecoveryRoutes } from '../modules/fee/fee-recovery.routes';
import { feeScrollRoutes } from '../modules/fee/fee-scroll.routes';
import { bankRoutes, expensesRoutes } from '../modules/finance/finance.routes';
import { hostelRoutes } from '../modules/hostel/hostel.routes';
import { inventoryRoutes } from '../modules/inventory/inventory.routes';
import { inventoryRequestsRoutes } from '../modules/inventory/inventory-requests.routes';
import { libraryRoutes } from '../modules/library/library.routes';
import { parentRoutes } from '../modules/parent/parent.routes';
import { receptionRoutes } from '../modules/reception/reception.routes';
import { staffRoutes } from '../modules/staff/staff.routes';
import { payrollRoutes, staffHrRoutes } from '../modules/staff/staff-hr.routes';
import { homeworkRoutes, teacherRoutes } from '../modules/teacher/teacher.routes';
import { transportRoutes } from '../modules/transport/transport.routes';
import { transportTrackingRoutes } from '../modules/transport/transport-tracking.routes';
import { schoolRoutes } from '../modules/school/school.routes';
import { platformRoutes } from '../modules/platform/platform.routes';
import { superAdminExtrasRoutes } from '../modules/superadmin/superadmin.routes';
import { studentsRoutes } from '../modules/students/students.routes';
import { supportRoutes } from '../modules/support/support.routes';
import { utilizeRoutes } from '../modules/utilize/utilize.routes';
import { certificatesRoutes } from '../modules/certificates/certificates.routes';
import { outpassRoutes } from '../modules/outpass/outpass.routes';
import { enquiryRoutes } from '../modules/enquiries/enquiry.routes';
import { reportsRoutes } from '../modules/reports/reports.routes';
import { schoolReportsRoutes } from '../modules/reports/school-reports.routes';
import { adminReportsRoutes } from '../modules/reports/admin-reports.routes';

import { adminDashboardRoutes } from '../modules/admin-dashboard/admin-dashboard.routes';

/** All domain routers mount here, under the server's `/api` base. */
export const apiRouter = Router();

apiRouter.use('/admin-dashboard', adminDashboardRoutes);

apiRouter.use('/auth', authRoutes);
// school-reports must mount before the blanket /super-admin routers below —
// those gate super_admin-only at their router root via `.use(requireRole(...))`,
// which fires for every sub-path under the prefix regardless of whether any
// of their own routes match, and would 403 support_engineer before the
// request ever reaches schoolReportsRoutes' own (broader) role gate.
apiRouter.use('/super-admin/school-reports', schoolReportsRoutes);
apiRouter.use('/super-admin', schoolRoutes);
apiRouter.use('/super-admin', superAdminExtrasRoutes);
apiRouter.use('/super-admin', platformRoutes);
apiRouter.use('/super-admin/reports', reportsRoutes);
apiRouter.use('/reports', adminReportsRoutes);
apiRouter.use('/sessions', sessionRoutes);
apiRouter.use('/enquiries', enquiryRoutes);
apiRouter.use('/classes', classRoutes);
apiRouter.use('/holidays', holidayRoutes);
apiRouter.use('/students', studentsRoutes);
apiRouter.use('/attendance', attendanceRoutes);
apiRouter.use('/timetable', timetableRoutes);
apiRouter.use('/exams', examRoutes);
apiRouter.use('/exams', examsProgressRoutes);
// More specific /fee/recovery mount must come before the blanket /fee mount —
// feeRoutes.use(requireRole(...)) runs for every path reaching that router
// (including /fee/recovery/*) before Express even looks at its sub-routes.
apiRouter.use('/fee/recovery', feeRecoveryRoutes);
apiRouter.use('/fee', feeRoutes);
apiRouter.use('/fee', feeExtrasRoutes);
apiRouter.use('/fee', feeAdjustRoutes);
apiRouter.use('/fee', feeRefundsRoutes);
apiRouter.use('/fee', feeScrollRoutes);
apiRouter.use('/bank', bankRoutes);
apiRouter.use('/expenses', expensesRoutes);
apiRouter.use('/library', libraryRoutes);
apiRouter.use('/hostel', hostelRoutes);
// Broader-role tracking routes before the core transportRoutes gate — same reason as fee/recovery above.
apiRouter.use('/transport', transportTrackingRoutes);
apiRouter.use('/transport', transportRoutes);
// Broader-role requests routes before the core inventoryRoutes gate — same reason as fee/recovery above.
apiRouter.use('/inventory', inventoryRequestsRoutes);
apiRouter.use('/inventory', inventoryRoutes);
apiRouter.use('/staff', staffRoutes);
apiRouter.use('/staff', staffHrRoutes);
apiRouter.use('/payroll', payrollRoutes);
apiRouter.use('/reception', receptionRoutes);
apiRouter.use('/coordinator', coordinatorRoutes);
apiRouter.use('/gate-manager', gateManagerRoutes);
apiRouter.use('/parent', parentRoutes);
apiRouter.use('/teacher', teacherRoutes);
apiRouter.use('/homework', homeworkRoutes);
apiRouter.use('/communication', communicationRoutes);
apiRouter.use('/circulars', circularRoutes);
apiRouter.use('/announcements', announcementRoutes);
apiRouter.use('/notifications', notificationRoutes);
apiRouter.use('/messaging', messagingRoutes);
apiRouter.use('/support', supportRoutes);
apiRouter.use('/utilize', utilizeRoutes);
apiRouter.use('/certificates', certificatesRoutes);
apiRouter.use('/outpass', outpassRoutes);
// ↑ Remaining: fee-extras, HR extras (payroll/leave), portals + deferred.
