import type { Request, Response } from 'express';

import { ApiError } from '../../lib/api-error';
import { created, send } from '../../lib/api-response';
import { libraryService } from './library.service';

function schoolId(req: Request): string {
  const id = req.user?.schoolId;
  if (!id) throw ApiError.forbidden('No school scope');
  return id;
}
const p = (req: Request, key: string): string => String(req.params[key]);
const q = (req: Request): Record<string, string> => req.query as Record<string, string>;

export const libraryController = {
  async kpi(req: Request, res: Response) {
    send(res, await libraryService.kpi(schoolId(req)));
  },
  async activity(req: Request, res: Response) {
    send(res, await libraryService.activity(schoolId(req)));
  },
  async getBooks(req: Request, res: Response) {
    send(res, await libraryService.getBooks(schoolId(req), q(req)));
  },
  async getBook(req: Request, res: Response) {
    send(res, await libraryService.getBook(schoolId(req), p(req, 'id')));
  },
  async getCopies(req: Request, res: Response) {
    send(res, await libraryService.getCopies(schoolId(req), p(req, 'id')));
  },
  async upsertBook(req: Request, res: Response) {
    created(res, await libraryService.upsertBook(schoolId(req), req.body));
  },
  async deleteBook(req: Request, res: Response) {
    send(res, await libraryService.deleteBook(schoolId(req), p(req, 'id')));
  },
  async getMembers(req: Request, res: Response) {
    send(res, await libraryService.getMembers(schoolId(req), q(req)));
  },
  async getMember(req: Request, res: Response) {
    send(res, await libraryService.getMember(schoolId(req), p(req, 'id')));
  },
  async toggleBlock(req: Request, res: Response) {
    send(res, await libraryService.toggleBlock(schoolId(req), p(req, 'id')));
  },
  async getIssues(req: Request, res: Response) {
    send(res, await libraryService.getIssues(schoolId(req), q(req)));
  },
  async issueBook(req: Request, res: Response) {
    created(res, await libraryService.issueBook(schoolId(req), req.body));
  },
  async returnBook(req: Request, res: Response) {
    send(res, await libraryService.returnBook(schoolId(req), req.body));
  },
  async collectFine(req: Request, res: Response) {
    send(res, await libraryService.collectFine(schoolId(req), p(req, 'id')));
  },
  async waiveFine(req: Request, res: Response) {
    const { reason } = req.body as { reason: string };
    send(res, await libraryService.waiveFine(schoolId(req), p(req, 'id'), reason));
  },
};
