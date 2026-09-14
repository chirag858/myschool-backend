import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { UserModel } from '../user/user.model';
import { teacherAppService } from './teacher-app.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
const uid = (req: Request): string => String(req.user?._id);
const q = (req: Request, k: string): string => String(req.query[k] ?? '');
async function name(req: Request): Promise<string> {
  const u = await UserModel.findById(req.user?._id).lean();
  return (u?.name as string) ?? 'Teacher';
}

export const teacherAppController = {
  async teaching(req: Request, res: Response) {
    send(res, await teacherAppService.teaching(schoolId(req), uid(req)));
  },
  async roster(req: Request, res: Response) {
    send(res, await teacherAppService.roster(schoolId(req), q(req, 'classSectionId')));
  },
  async dashboard(req: Request, res: Response) {
    send(res, await teacherAppService.dashboard(schoolId(req), uid(req)));
  },

  async getAssignments(req: Request, res: Response) {
    send(res, await teacherAppService.getAssignments(schoolId(req), uid(req), q(req, 'classSectionId')));
  },
  async createAssignment(req: Request, res: Response) {
    created(res, await teacherAppService.createAssignment(schoolId(req), uid(req), req.body));
  },
  async updateAssignment(req: Request, res: Response) {
    send(res, await teacherAppService.updateAssignment(schoolId(req), uid(req), String(req.body.id), req.body));
  },
  async deactivateAssignment(req: Request, res: Response) {
    await teacherAppService.deactivateAssignment(schoolId(req), uid(req), String(req.body.id));
    send(res, { success: true });
  },
  async submissions(req: Request, res: Response) {
    send(res, await teacherAppService.submissions(schoolId(req), q(req, 'assignmentId')));
  },
  async grade(req: Request, res: Response) {
    const { assignmentId, studentId, marks, feedback } = req.body as { assignmentId: string; studentId: string; marks: number; feedback?: string };
    send(res, await teacherAppService.grade(schoolId(req), assignmentId, studentId, { marks, feedback }));
  },

  async getAttendance(req: Request, res: Response) {
    send(res, await teacherAppService.getAttendance(schoolId(req), q(req, 'classSectionId'), q(req, 'date')));
  },
  async submitAttendance(req: Request, res: Response) {
    const { classSectionId, date, entries } = req.body as { classSectionId: string; date: string; entries: Array<{ studentId: string; status: string }> };
    send(res, await teacherAppService.submitAttendance(schoolId(req), classSectionId, date, entries, await name(req)));
  },

  async getContent(req: Request, res: Response) {
    send(res, await teacherAppService.getContent(schoolId(req), uid(req), q(req, 'type'), q(req, 'classSectionId')));
  },
  async createContent(req: Request, res: Response) {
    created(res, await teacherAppService.createContent(schoolId(req), uid(req), req.body));
  },
  async updateContent(req: Request, res: Response) {
    send(res, await teacherAppService.updateContent(schoolId(req), uid(req), String(req.body.id), req.body));
  },
  async deactivateContent(req: Request, res: Response) {
    await teacherAppService.deactivateContent(schoolId(req), uid(req), String(req.body.id));
    send(res, { success: true });
  },

  async getAssessments(req: Request, res: Response) {
    send(res, await teacherAppService.getAssessments(schoolId(req), q(req, 'subjectId') || undefined));
  },
  async marksSheet(req: Request, res: Response) {
    send(res, await teacherAppService.marksSheet(schoolId(req), q(req, 'assessmentId'), q(req, 'classSectionId')));
  },
  async saveMarks(req: Request, res: Response) {
    const { assessmentId, classSectionId, rows, action } = req.body as {
      assessmentId: string;
      classSectionId: string;
      rows: Array<{ studentId: string; marks: Record<string, number | null> }>;
      action?: string;
    };
    send(res, await teacherAppService.saveMarks(schoolId(req), assessmentId, classSectionId, rows, action));
  },

  async performance(req: Request, res: Response) {
    send(res, await teacherAppService.performance(schoolId(req), q(req, 'classSectionId')));
  },
  async studentPerformance(req: Request, res: Response) {
    send(res, await teacherAppService.studentPerformance(schoolId(req), q(req, 'classSectionId'), q(req, 'studentId')));
  },
};
