# myschool-backend

REST API for MySmartCampus ERP. Consumed by `mysmartcampus-web` (and a mobile app).

Longer-form rules live in [RULES.md](RULES.md) — still the reference for definition-of-done and testing depth. Where RULES.md and the code disagree, the code wins (see "Response shape" below).

## Stack

- **Runtime/language:** Node (CommonJS), TypeScript 5.7 `strict`, run in dev via `tsx`.
- **HTTP:** Express 5, with `helmet`, `cors`, `morgan`.
- **DB:** MongoDB via Mongoose 8.
- **Validation:** Zod 4. **Auth:** `jsonwebtoken` + `bcryptjs`.
- **Also used:** `exceljs` (spreadsheet export), `pdfkit` (receipts/certificates), `node-cron` (scheduled jobs), `dotenv`.
- **Tests:** Vitest 3 + Supertest + `mongodb-memory-server`.

## Folder map (`src/`)

| Path | Contents |
| :--- | :--- |
| `src/index.ts` | Process entry — connects DB, registers cron jobs, `app.listen`. |
| `src/app.ts` | `createApp()` — middleware chain, `/health`, mounts `apiRouter` at `/api`, then `notFound` + `errorHandler`. |
| `src/routes/index.ts` | The only mount table. Every domain router is registered here. |
| `src/modules/<domain>/` | One folder per domain (36 of them: academics, attendance, auth, certificates, exams, fee, finance, hostel, inventory, library, outpass, parent, students, staff, teacher, timetable, transport, utilize, …). |
| `src/middleware/` | `auth.ts` (`authenticate`, `requireRole`, `tenantFilter`), `validate.ts`, `error.ts`, `not-found.ts`. |
| `src/lib/` | Shared helpers: `api-error.ts`, `api-response.ts`, `async-handler.ts`, `jwt.ts`, `logger.ts`, `paginate.ts`, `messaging-provider.ts`. |
| `src/config/` | `env.ts` (Zod-parsed `process.env`), `db.ts` (Mongoose connect). |
| `src/seed/seed.ts` | Demo school + demo accounts the frontend logs in with. |
| `src/scripts/` | One-off data backfills (`backfill-fee-status.ts`, `backfill-missing-classes.ts`, `backfill-class-incharge.ts`). |
| `tests/setup.ts` | Global Vitest setup (spins the in-memory Mongo). **The actual tests live next to the code**, as `src/modules/<domain>/<name>.test.ts` (28 files). |

Inside a module, files are `<name>.routes.ts`, `<name>.controller.ts`, `<name>.service.ts`, `<name>.model.ts` / `<name>.models.ts`, `<name>.validation.ts`, `<name>.test.ts`. `teacher/` is the one module exporting two routers from a single `teacher.routes.ts` — `teacherRoutes` (`/api/teacher`, the teacher's own portal) and `homeworkRoutes` (`/api/homework`, the cross-role overview). A domain that outgrew one file splits by prefix rather than nesting — e.g. `fee/` holds `fee.*`, `fee-extras.*`, `fee-adjust.*`, `fee-refunds.*`, `fee-recovery.*`, `fee-scroll.*`, each a full set.

## Commands (npm — this repo is not pnpm)

```bash
npm run dev                       # tsx watch src/index.ts
npm start                         # node dist/index.js (after build)
npm run build                     # tsc -p tsconfig.json → dist/
npm run typecheck                 # tsc --noEmit
npm test                          # vitest run (all)
npm run test:watch                # vitest
npx vitest run src/modules/fee/fee.test.ts   # single file
npm run seed                      # tsx src/seed/seed.ts
npm run backfill:fee-status       # one-off data repair
npm run backfill:missing-classes  # one-off data repair
npm run backfill:class-incharge   # one-off data repair
```

There is **no lint script and no ESLint config in this repo** — `npm run typecheck` + `npm test` are the full gate. (Some source files carry `eslint-disable` comments, left over from an editor-level setup.)

## Conventions (verified in code)

- **Response shape: raw payload, no envelope.** `lib/api-response.ts` exports `send(res, payload, status?)`, `created(res, payload)`, `noContent(res)` — they `res.json(payload)` directly, because the frontend reads `response.data` as the payload. RULES.md §3 still describes a `{ success, data }` envelope; that is stale, do not reintroduce it.
- **Errors are the only structured body:** `{ message, code, details? }`, produced solely by `middleware/error.ts`. Throw `ApiError` (`ApiError.unauthorized()`, `.forbidden()`, `.badRequest(msg, issues)`, …) and let it bubble. Mongo duplicate-key (11000) → 409 `CONFLICT`, Mongoose `ValidationError`/`CastError` → 400 `VALIDATION_ERROR`, anything else → 500 `INTERNAL`.
- **Every async route handler is wrapped in `asyncHandler(...)`** so rejections reach the error handler — Express 5 does not do this for you here.
- **Route file pattern:** build role gates as arrays and spread them, e.g. `const gate = [authenticate, requireRole(...ACADEMIC_ADMIN_ROLES)]`, then `router.post('/', ...gate, validate({ body: createXSchema }), asyncHandler(ctrl.create))`. Role-name constants come from `modules/user/roles.ts`, not string literals.
- **`validate({ body, query, params })`** parses with Zod and writes the coerced result back to `req.body` only — `req.query` is read-only in Express 5, so controllers read query params as raw strings and coerce them (see `lib/paginate.ts`).
- **Tenant scoping is mandatory.** `authenticate` sets `req.user = { _id, role, schoolId? }`; every school-owned query filters by it, via `tenantFilter(req)` which returns `{}` for `super_admin` and throws 403 if a non-super-admin has no `schoolId`.
- **Controllers stay thin** (parse → call service → send); all business logic lives in `<domain>.service.ts`, exported as a service object.
- Mount order in `routes/index.ts` is load-bearing: a more specific prefix must be mounted **before** a blanket one on the same path (`/fee/recovery` before `/fee`, `transportTrackingRoutes` before `transportRoutes`, `inventoryRequestsRoutes` before `inventoryRoutes`) because the blanket router applies `requireRole` to everything reaching it. Existing comments in the file say so — keep them.
- Naming: kebab-case files, `camelCase` values, `PascalCase` types/models. No `any`; explicit return types on exports.
- Config only through `config/env.ts` (`env.PORT`, `env.MONGO_URI`, `env.JWT_ACCESS_SECRET`, `env.JWT_REFRESH_SECRET`, `env.JWT_ACCESS_TTL`, `env.JWT_REFRESH_TTL`, `env.CORS_ORIGIN`, `env.NODE_ENV`) — never read `process.env` elsewhere.
- Tests run **sequentially** (`fileParallelism: false`, `retry: 2`, 30s test / 120s hook timeouts) — one in-memory Mongo per test file. Assume that; don't add parallel-unsafe global state, and don't "fix" a slow suite by enabling parallelism.
- **Class incharge is one class per teacher, one teacher per class.** `academics.service.ts`'s `getInchargeSection`/`setInchargeSection`/`clearInchargeSection` (backed by `Section.classTeacherId`/`classTeacherName`) are the only source of truth for "which class does this teacher manage" — `teacher.service.ts` (my-classes/my-students, homework/assignment/circular creation) and `attendance.controller.ts` (mark/save/override) all import from there rather than re-deriving it. This is separate from `TeacherClassAssignment` (multi-row subject-teaching, still drives marks entry) — don't conflate the two.

## Must never do

- Never re-add the `{ success: true, data }` envelope to success responses — it breaks every frontend `.api.ts` seam.
- Never `res.status(...).json(...)` an error inline; throw `ApiError` so the central handler formats it.
- Never write a school-owned query without a `schoolId` filter, and never widen a route to `super_admin`-only data without a role gate.
- Never return `passwordHash` or any secret field — models drop it in their `toJSON` transform; don't bypass it with `.lean()` + manual mapping.
- Never rename `_id` to `id` in a response; the frontend reads `_id`.
- Never invent an endpoint shape — read the matching `mysmartcampus-web/src/features/<x>/services/*.api.ts` first and return exactly what it destructures.
- Never edit `dist/`, `node_modules/`, `.mongo-memory/`, or `.env`.
- Never reorder the mounts in `src/routes/index.ts` without checking the specificity comments.
- Never add a domain without its `*.test.ts` (status + shape + auth/role + tenant isolation + validation).
