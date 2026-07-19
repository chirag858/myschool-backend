import { Router } from 'express';

import { classRoutes, holidayRoutes, sessionRoutes } from '../modules/academics/academics.routes';
import { attendanceRoutes } from '../modules/attendance/attendance.routes';
import { authRoutes } from '../modules/auth/auth.routes';
import { coordinatorRoutes } from '../modules/coordinator/coordinator.routes';
import {
  announcementRoutes,
  circularRoutes,
  communicationRoutes,
  notificationRoutes,
} from '../modules/communication/communication.routes';
import { examRoutes } from '../modules/exams/exams.routes';
import { gateManagerRoutes } from '../modules/gate-manager/gate-manager.routes';
import { feeRoutes } from '../modules/fee/fee.routes';
import { feeExtrasRoutes } from '../modules/fee/fee-extras.routes';
import { feeAdjustRoutes } from '../modules/fee/fee-adjust.routes';
import { feeRefundsRoutes } from '../modules/fee/fee-refunds.routes';
import { bankRoutes, expensesRoutes } from '../modules/finance/finance.routes';
import { hostelRoutes } from '../modules/hostel/hostel.routes';
import { inventoryRoutes } from '../modules/inventory/inventory.routes';
import { libraryRoutes } from '../modules/library/library.routes';
import { parentRoutes } from '../modules/parent/parent.routes';
import { receptionRoutes } from '../modules/reception/reception.routes';
import { staffRoutes } from '../modules/staff/staff.routes';
import { payrollRoutes, staffHrRoutes } from '../modules/staff/staff-hr.routes';
import { homeworkRoutes, teacherRoutes } from '../modules/teacher/teacher.routes';
import { transportRoutes } from '../modules/transport/transport.routes';
import { schoolRoutes } from '../modules/school/school.routes';
import { superAdminExtrasRoutes } from '../modules/superadmin/superadmin.routes';
import { studentsRoutes } from '../modules/students/students.routes';

/** All domain routers mount here, under the server's `/api` base. */
export const apiRouter = Router();

apiRouter.use('/auth', authRoutes);
apiRouter.use('/super-admin', schoolRoutes);
apiRouter.use('/super-admin', superAdminExtrasRoutes);
apiRouter.use('/sessions', sessionRoutes);
apiRouter.use('/classes', classRoutes);
apiRouter.use('/holidays', holidayRoutes);
apiRouter.use('/students', studentsRoutes);
apiRouter.use('/attendance', attendanceRoutes);
apiRouter.use('/exams', examRoutes);
apiRouter.use('/fee', feeRoutes);
apiRouter.use('/fee', feeExtrasRoutes);
apiRouter.use('/fee', feeAdjustRoutes);
apiRouter.use('/fee', feeRefundsRoutes);
apiRouter.use('/bank', bankRoutes);
apiRouter.use('/expenses', expensesRoutes);
apiRouter.use('/library', libraryRoutes);
apiRouter.use('/hostel', hostelRoutes);
apiRouter.use('/transport', transportRoutes);
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
// ↑ Remaining: fee-extras, HR extras (payroll/leave), portals + deferred.
