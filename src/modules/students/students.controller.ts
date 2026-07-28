import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { studentsService } from './students.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}

export const studentsController = {
  async list(req: Request, res: Response) {
    send(res, await studentsService.list(schoolId(req), req.query));
  },
  async classSummary(req: Request, res: Response) {
    send(res, await studentsService.classSummary(schoolId(req)));
  },
  async generateAdmissionNumber(req: Request, res: Response) {
    send(res, await studentsService.generateAdmissionNumber(schoolId(req)));
  },
  async checkAdmissionNumber(req: Request, res: Response) {
    const { admissionNumber } = req.body as { admissionNumber: string };
    send(res, await studentsService.checkAdmissionNumber(schoolId(req), admissionNumber));
  },
  async admissionStats(req: Request, res: Response) {
    send(res, await studentsService.admissionStats(schoolId(req)));
  },
  async checkDuplicate(req: Request, res: Response) {
    const payload = req.body as { name: string; dateOfBirth: string; fatherName?: string };
    send(res, await studentsService.checkDuplicate(schoolId(req), payload));
  },
  async checkMobile(req: Request, res: Response) {
    const { mobile } = req.body as { mobile: string };
    send(res, await studentsService.checkMobile(schoolId(req), mobile));
  },
  async create(req: Request, res: Response) {
    created(res, await studentsService.create(schoolId(req), req.body));
  },
  async profile(req: Request, res: Response) {
    send(res, await studentsService.profile(schoolId(req), String(req.params.id)));
  },
  async bulkStatus(req: Request, res: Response) {
    const { studentIds, status } = req.body as { studentIds: string[]; status: string };
    send(res, await studentsService.bulkStatus(schoolId(req), studentIds, status));
  },
  async bulkTransfer(req: Request, res: Response) {
    const { studentIds, toClassName, toSection } = req.body as {
      studentIds: string[];
      toClassName: string;
      toSection: string;
    };
    send(res, await studentsService.bulkTransfer(schoolId(req), studentIds, toClassName, toSection));
  },
  async bulkPromote(req: Request, res: Response) {
    const { fromClassKey, toClassName, toSection, toSession } = req.body as {
      fromClassKey: string;
      toClassName: string;
      toSection: string;
      toSession: string;
    };
    send(res, await studentsService.bulkPromote(schoolId(req), fromClassKey, toClassName, toSection, toSession));
  },
  async getDocuments(req: Request, res: Response) {
    send(res, await studentsService.getDocuments(schoolId(req), String(req.params.id)));
  },
  async addDocument(req: Request, res: Response) {
    created(res, await studentsService.addDocument(schoolId(req), String(req.params.id), req.body));
  },
  async deleteDocument(req: Request, res: Response) {
    await studentsService.deleteDocument(schoolId(req), String(req.params.id), String(req.params.docId));
    res.status(204).end();
  },
};
