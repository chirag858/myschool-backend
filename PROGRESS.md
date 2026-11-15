# PROGRESS — Events gallery + Syllabus (multi-repo)

## Goal
Client ask (WhatsApp): parent quick links missing **Events** photo gallery
(teacher uploads photos, parents download) + a **Syllabus** quick link.
Scope chosen by user: full end-to-end, upload on **web + mobile both**, gallery
name = **Events**. One Events tile + one Syllabus tile.

## Decisions
- Two new backend modules: `events`, `syllabus`. Role-gated only (no
  `requireModule`) — client wants these ALWAYS visible in quick links.
- classKey format = `${className}-${section}` (matches parent-app `classKeyOf`).
  Album/doc target by `classKeys: string[]`; empty = whole school.
- Parent read endpoints live in **parent-app** (owns child scoping via
  `ownChild` + `classKeyOf`), calling `eventsService.listForClass` /
  `syllabusService.listForClass`.
- No R2 delete helper exists; album/doc delete removes DB row only (orphan R2
  object acceptable, same as homework attachments).
- Staff upload gate roles: school_admin, principal, coordinator, teacher.

## Status
- [x] backend events module (model/validation/service/controller/routes/test)
- [x] backend syllabus module (same)
- [x] mount in routes/index.ts
- [x] parent-app: events + syllabus read endpoints (tests cover via events/syllabus.test.ts)
- [x] backend typecheck + test (11/11 pass, tsc clean)
- [x] mobile parent: tiles + routes + screens + api + i18n (events-screen, event-album-screen, syllabus-screen; navigator wired; en/hi/pa keys; type-check clean)
- [ ] mobile teacher: upload UI
- [ ] web ERP: staff upload pages

## Endpoint contract (responses use `id`, not `_id` — mobile + new web seams authored here)
- Staff events: `GET /api/events` {rows:[{id,title,description,eventDate,classKeys,coverUrl,photoCount,createdBy,createdAt}]},
  `POST /api/events`, `POST /api/events/upload-photo` (multipart file)→{url,key}, `GET/PATCH/DELETE /api/events/:id`,
  `POST /api/events/:id/photos` {url,key?,caption?}, `DELETE /api/events/:id/photos/:photoId`. Detail adds `photos:[{id,url,caption,uploadedAt}]`.
- Staff syllabus: `GET /api/syllabus` {rows:[{id,title,classKey,subject,term,fileUrl,fileName,createdBy,createdAt}]},
  `POST /api/syllabus`, `POST /api/syllabus/upload-file` (multipart)→{url,key,fileName}, `PATCH/DELETE /api/syllabus/:id`.
- Parent: `GET /api/parent/events?childId=`, `GET /api/parent/events/:id?childId=`, `GET /api/parent/syllabus?childId=`.

## Done earlier this session
- Fixed "Duplicate value" (stale users index): migration `fix:user-indexes` +
  students.service parent-link hardened. User must run `npm run fix:user-indexes`
  on prod VPS.
- Parent dashboard redesign: greeting removed, school name in header subtitle.
