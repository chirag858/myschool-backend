import { Router } from 'express';
import { adminDashboardController } from './admin-dashboard.controller';
import { authenticate, requireRole } from '../../middleware/auth';

const router = Router();

router.use(authenticate);
router.use(requireRole('school_admin', 'principal', 'super_admin'));

router.get('/stats', adminDashboardController.getStats);
router.get('/income-breakdown', adminDashboardController.getIncomeBreakdown);
router.get('/attendance-overview', adminDashboardController.getAttendanceOverview);
router.get('/pending-approvals', adminDashboardController.getPendingApprovals);
router.get('/recent-admissions', adminDashboardController.getRecentAdmissions);
router.get('/notices', adminDashboardController.getNotices);

export const adminDashboardRoutes = router;
