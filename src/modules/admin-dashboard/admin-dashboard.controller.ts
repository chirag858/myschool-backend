import type { Request, Response } from 'express';
import { adminDashboardService } from './admin-dashboard.service';

export const adminDashboardController = {
  async getStats(req: Request, res: Response) {
    try {
      const data = await adminDashboardService.getStats(req.user!.schoolId!);
      res.json(data);
    } catch (error) {
      console.error('getStats error:', error);
      res.status(500).json({ error: 'Failed to get stats' });
    }
  },

  async getStaffAttendanceByDept(req: Request, res: Response) {
    try {
      const data = await adminDashboardService.getStaffAttendanceByDept(req.user!.schoolId!);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get staff attendance by department' });
    }
  },

  async getIncomeBreakdown(req: Request, res: Response) {
    try {
      const data = await adminDashboardService.getIncomeBreakdown(req.user!.schoolId!);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get income breakdown' });
    }
  },

  async getAttendanceOverview(req: Request, res: Response) {
    try {
      const data = await adminDashboardService.getAttendanceOverview(req.user!.schoolId!);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get attendance overview' });
    }
  },

  async getPendingApprovals(req: Request, res: Response) {
    try {
      const data = await adminDashboardService.getPendingApprovals(req.user!.schoolId!);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get pending approvals' });
    }
  },

  async getRecentAdmissions(req: Request, res: Response) {
    try {
      const data = await adminDashboardService.getRecentAdmissions(req.user!.schoolId!);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get recent admissions' });
    }
  },

  async getNotices(req: Request, res: Response) {
    try {
      const data = await adminDashboardService.getNotices(req.user!.schoolId!);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get notices' });
    }
  }
};
