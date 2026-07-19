import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { libraryController } from './library.controller';
import { idParam, issueSchema, returnSchema, upsertBookSchema, waiveSchema } from './library.validation';

/** Mounted at /api/library. School admin + principal. */
export const libraryRoutes = Router();
libraryRoutes.use(authenticate, requireRole('school_admin', 'principal'));

libraryRoutes.get('/dashboard', asyncHandler(libraryController.kpi));
libraryRoutes.get('/activity', asyncHandler(libraryController.activity));

libraryRoutes.get('/books', asyncHandler(libraryController.getBooks));
libraryRoutes.post('/books', validate({ body: upsertBookSchema }), asyncHandler(libraryController.upsertBook));
libraryRoutes.get('/books/:id/copies', validate({ params: idParam }), asyncHandler(libraryController.getCopies));
libraryRoutes.get('/books/:id', validate({ params: idParam }), asyncHandler(libraryController.getBook));
libraryRoutes.delete('/books/:id', validate({ params: idParam }), asyncHandler(libraryController.deleteBook));

libraryRoutes.get('/members', asyncHandler(libraryController.getMembers));
libraryRoutes.get('/members/:id', validate({ params: idParam }), asyncHandler(libraryController.getMember));
libraryRoutes.patch('/members/:id/block', validate({ params: idParam }), asyncHandler(libraryController.toggleBlock));

libraryRoutes.get('/issues', asyncHandler(libraryController.getIssues));
libraryRoutes.post('/issue', validate({ body: issueSchema }), asyncHandler(libraryController.issueBook));
libraryRoutes.post('/return', validate({ body: returnSchema }), asyncHandler(libraryController.returnBook));

libraryRoutes.post('/fines/:id/collect', validate({ params: idParam }), asyncHandler(libraryController.collectFine));
libraryRoutes.post('/fines/:id/waive', validate({ params: idParam, body: waiveSchema }), asyncHandler(libraryController.waiveFine));
