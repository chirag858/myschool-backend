import { Router } from 'express';
import { adminDashboardController } from './admin-dashboard.controller';
import { authenticate, requireRole } from '../../middleware/auth';
import { asyncHandler } from '../../lib/async-handler';

const router = Router();

router.use(authenticate);
router.use(requireRole('school_admin', 'principal', 'super_admin'));

router.get('/stats', asyncHandler(adminDashboardController.getStats));
router.get('/income-breakdown', asyncHandler(adminDashboardController.getIncomeBreakdown));
router.get('/attendance-overview', asyncHandler(adminDashboardController.getAttendanceOverview));
router.get('/staff-attendance-by-dept', asyncHandler(adminDashboardController.getStaffAttendanceByDept));
router.get('/pending-approvals', asyncHandler(adminDashboardController.getPendingApprovals));
router.get('/recent-admissions', asyncHandler(adminDashboardController.getRecentAdmissions));
router.get('/notices', asyncHandler(adminDashboardController.getNotices));

export const adminDashboardRoutes = router;
