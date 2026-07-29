import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { parentAppController as C } from './parent-app.controller';

/**
 * Mounted at /api/parent AFTER the web parent router — the mobile-only paths
 * below fall through. The three paths the web router already owns
 * (/children, /attendance, /complaints) are served here under /app-* to avoid
 * colliding with the web parent portal's different shapes; the mobile client
 * calls these /app-* paths.
 */
export const parentAppRoutes = Router();
// Parent + student: the mobile merges the student experience into the parent
// app, so a student hits these paths too (scoped to their own record).
parentAppRoutes.use(authenticate, requireRole('parent', 'student'));

parentAppRoutes.get('/app-children', asyncHandler(C.children));
parentAppRoutes.get('/dashboard-summary', asyncHandler(C.dashboardSummary));
parentAppRoutes.get('/profile', asyncHandler(C.profile));
parentAppRoutes.get('/app-attendance', asyncHandler(C.attendance));

parentAppRoutes.get('/exam/timetable', asyncHandler(C.examTimetable));
parentAppRoutes.get('/exam/schedules', asyncHandler(C.examSchedules));
parentAppRoutes.get('/exam/marks', asyncHandler(C.examMarks));

parentAppRoutes.get('/fees/dues', asyncHandler(C.feeDues));
parentAppRoutes.get('/fees/receipts', asyncHandler(C.feeReceipts));
parentAppRoutes.get('/fees/ledger', asyncHandler(C.feeLedger));
parentAppRoutes.post('/fees/payment/order', asyncHandler(C.paymentOrder));
parentAppRoutes.post('/fees/payment/verify', asyncHandler(C.paymentVerify));

parentAppRoutes.get('/notifications', asyncHandler(C.notifications));
parentAppRoutes.post('/notifications/read', asyncHandler(C.markNotifRead));
parentAppRoutes.post('/notifications/read-all', asyncHandler(C.markAllNotifRead));

parentAppRoutes.get('/app-complaints', asyncHandler(C.complaints));
parentAppRoutes.post('/app-complaints', asyncHandler(C.submitComplaint));

parentAppRoutes.get('/requests', asyncHandler(C.requests));
parentAppRoutes.post('/requests', asyncHandler(C.submitRequest));
parentAppRoutes.post('/requests/cancel', asyncHandler(C.cancelRequest));

parentAppRoutes.get('/outpass', asyncHandler(C.outpasses));
parentAppRoutes.post('/outpass/otp', asyncHandler(C.outpassOtp));
parentAppRoutes.post('/outpass/approve', asyncHandler(C.outpassApprove));
parentAppRoutes.post('/outpass/decline', asyncHandler(C.outpassDecline));

parentAppRoutes.get('/messenger/conversations', asyncHandler(C.conversations));
parentAppRoutes.get('/messenger/thread', asyncHandler(C.thread));
parentAppRoutes.post('/messenger/send', asyncHandler(C.sendMessage));
parentAppRoutes.post('/messenger/read', asyncHandler(C.markConvRead));

parentAppRoutes.get('/transport/assignment', asyncHandler(C.transportAssignment));
parentAppRoutes.get('/transport/live', asyncHandler(C.transportLive));

parentAppRoutes.get('/bag', asyncHandler(C.bag));
parentAppRoutes.get('/rewards', asyncHandler(C.rewards));
parentAppRoutes.get('/class-incharge', asyncHandler(C.classIncharge));
parentAppRoutes.get('/online-classes', asyncHandler(C.onlineClasses));
