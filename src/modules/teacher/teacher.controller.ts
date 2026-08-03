import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { teacherService } from './teacher.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
const userId = (req: Request): string => String(req.user?._id);
const p = (req: Request, key: string): string => String(req.params[key]);
const q = (req: Request, key: string): string | undefined => {
  const v = req.query[key];
  return v == null ? undefined : String(v);
};

export const teacherController = {
  // Context
  async myClasses(req: Request, res: Response) {
    send(res, await teacherService.getMyClasses(schoolId(req), userId(req)));
  },
  async myStudents(req: Request, res: Response) {
    send(res, await teacherService.getMyStudents(schoolId(req), userId(req), { classKey: q(req, 'classKey'), search: q(req, 'search') }));
  },
  async myExams(req: Request, res: Response) {
    send(res, await teacherService.getMyExams(schoolId(req), userId(req)));
  },
  async myTeaching(req: Request, res: Response) {
    send(res, await teacherService.getMyTeaching(schoolId(req), userId(req)));
  },
  async dashboardSummary(req: Request, res: Response) {
    send(res, await teacherService.getDashboardSummary(schoolId(req), userId(req)));
  },

  // Homework
  async getHomework(req: Request, res: Response) {
    send(res, await teacherService.getHomework(schoolId(req), userId(req)));
  },
  async getAllHomework(req: Request, res: Response) {
    send(res, await teacherService.getAllHomework(schoolId(req), req.query as Record<string, string>));
  },
  async createHomework(req: Request, res: Response) {
    created(res, await teacherService.createHomework(schoolId(req), userId(req), req.body, String(req.user?.role ?? 'unknown')));
  },
  async updateHomework(req: Request, res: Response) {
    send(res, await teacherService.updateHomework(schoolId(req), userId(req), p(req, 'id'), req.body, String(req.user?.role ?? 'unknown')));
  },
  async deleteHomework(req: Request, res: Response) {
    await teacherService.deleteHomework(schoolId(req), userId(req), p(req, 'id'));
    res.status(204).end();
  },
  async homeworkById(req: Request, res: Response) {
    send(res, await teacherService.getHomeworkById(schoolId(req), p(req, 'id')));
  },
  async homeworkSubmissions(req: Request, res: Response) {
    send(res, await teacherService.getHomeworkSubmissions(schoolId(req), p(req, 'id')));
  },
  async setHomeworkSubmission(req: Request, res: Response) {
    send(
      res,
      await teacherService.setHomeworkSubmission(
        schoolId(req),
        p(req, 'id'),
        p(req, 'studentId'),
        req.body as { status: string; marks?: number; remark?: string; attachment?: string },
      ),
    );
  },
  async remindHomework(req: Request, res: Response) {
    send(res, await teacherService.remindPendingHomework(schoolId(req), p(req, 'id')));
  },

  // Assignments
  async getAssignments(req: Request, res: Response) {
    send(res, await teacherService.getAssignments(schoolId(req), userId(req), { classKey: q(req, 'classKey'), status: q(req, 'status') }));
  },
  async createAssignment(req: Request, res: Response) {
    created(res, await teacherService.createAssignment(schoolId(req), userId(req), req.body, String(req.user?.role ?? 'unknown')));
  },
  async updateAssignment(req: Request, res: Response) {
    send(res, await teacherService.updateAssignment(schoolId(req), userId(req), p(req, 'id'), req.body, String(req.user?.role ?? 'unknown')));
  },
  async closeAssignment(req: Request, res: Response) {
    send(res, await teacherService.closeAssignment(schoolId(req), userId(req), p(req, 'id')));
  },
  async deleteAssignment(req: Request, res: Response) {
    await teacherService.deleteAssignment(schoolId(req), userId(req), p(req, 'id'));
    res.status(204).end();
  },
  async getSubmissions(req: Request, res: Response) {
    send(res, await teacherService.getSubmissions(schoolId(req), p(req, 'id')));
  },
  async receiveSubmission(req: Request, res: Response) {
    send(
      res,
      await teacherService.receiveSubmission(
        schoolId(req),
        p(req, 'id'),
        p(req, 'studentId'),
        req.body as { status: string; textContent?: string; fileName?: string },
      ),
    );
  },
  async gradeSubmission(req: Request, res: Response) {
    const { marks, feedback } = req.body as { marks: number; feedback: string };
    send(res, await teacherService.gradeSubmission(schoolId(req), p(req, 'id'), p(req, 'studentId'), { marks, feedback }));
  },

  // Circulars
  async receivedCirculars(req: Request, res: Response) {
    send(res, await teacherService.getReceivedCirculars(schoolId(req), userId(req)));
  },
  async myCirculars(req: Request, res: Response) {
    send(res, await teacherService.getMyCirculars(schoolId(req), userId(req)));
  },
  async createCircular(req: Request, res: Response) {
    created(res, await teacherService.createCircular(schoolId(req), userId(req), req.body, String(req.user?.role ?? 'unknown')));
  },
  async updateCircular(req: Request, res: Response) {
    send(res, await teacherService.updateCircular(schoolId(req), userId(req), p(req, 'id'), req.body, String(req.user?.role ?? 'unknown')));
  },
  async deleteCircular(req: Request, res: Response) {
    await teacherService.deleteCircular(schoolId(req), userId(req), p(req, 'id'));
    res.status(204).end();
  },
  async readCircular(req: Request, res: Response) {
    send(res, await teacherService.markCircularRead(schoolId(req), userId(req), p(req, 'id')));
  },

  // Leave
  async leaveBalance(req: Request, res: Response) {
    send(res, await teacherService.getLeaveBalance(schoolId(req), userId(req)));
  },
  async leaveHistory(req: Request, res: Response) {
    send(res, await teacherService.getLeaveHistory(schoolId(req), userId(req), { type: q(req, 'type'), status: q(req, 'status') }));
  },
  async applyLeave(req: Request, res: Response) {
    created(res, await teacherService.applyLeave(schoolId(req), userId(req), req.body));
  },
  async cancelLeave(req: Request, res: Response) {
    send(res, await teacherService.cancelLeave(schoolId(req), userId(req), p(req, 'id')));
  },
};
