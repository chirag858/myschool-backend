# Backend Development Rules — myschool-backend

The REST API for MySmartCampus. Consumed by `mysmartcampus-erp` (web) and `mobile-app`. These rules are enforced for every domain. Stack: **Node + Express 5 + TypeScript (strict) + MongoDB (Mongoose) + Zod + JWT**, tested with **Vitest + Supertest + mongodb-memory-server**.

---

## 1. The contract is the frontend

The frontend defines the API. Every endpoint must match what the frontend service (`mysmartcampus-erp/src/features/<x>/services/*.api.ts`) and its TypeScript **types** expect.

1. **Response shapes = frontend types.** If the frontend types a call as `Promise<Receipt[]>`, the endpoint returns exactly that shape inside the envelope's `data`. Never invent fields the client doesn't read; never omit fields it does.
2. **IDs are `_id` (string).** MongoDB `_id` is serialized to a string. Never rename to `id` — the frontend reads `_id`.
3. **Timestamps are ISO strings** (`createdAt`, `updatedAt`) via Mongoose `timestamps: true` + a `toJSON` transform.
4. **Money is integer paise** internally where the frontend expects numbers in rupees — match the field's existing numeric convention per domain (check the type before assuming).

---

## 2. Routing

- Everything is mounted under **`/api`** (server base). Axios `baseURL` = `http://localhost:3001/api`; frontend calls use paths **without** a leading `/api` (`/auth/login`, `/students`, `/fee/heads`) — the base supplies it. Normalize any frontend seam that included `/api` when wiring.
- One router per domain: `modules/<domain>/<domain>.routes.ts`, mounted in `routes/index.ts`.
- REST conventions: `GET /students`, `GET /students/:id`, `POST /students`, `PUT /students/:id`, `PATCH /students/:id/<action>`, `DELETE /students/:id`. Nested resources: `GET /students/:id/fee-ledger`.

---

## 3. Response envelope

Every success response:
```json
{ "success": true, "data": <payload>, "meta": { ...pagination? } }
```
Every error response (from the central error handler):
```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }
```

- **BUT** the frontend often destructures `response.data` as the payload directly (e.g. `const { data } = await apiClient.get<Receipt[]>('/fee/receipts'); return data;`). So the payload the client wants IS `data`. Confirmed pattern: controllers send `res.json(ok(payload, meta))` and the client reads `data`. Where a frontend seam expects the **raw array/object** (not wrapped), honor that — check the seam. Default to the envelope; only unwrap when the specific frontend call requires it. Document any unwrapped endpoint in the module.

> Practical rule: read the exact frontend `.api.ts` method before writing the controller. Return what THAT method returns. The envelope is the default; the frontend seam wins on conflict.

---

## 4. Validation

- Every write endpoint validates its body/params/query with a **Zod** schema via the `validate` middleware. Reuse the frontend Zod schemas' intent where they exist (`features/<x>/schemas`).
- Invalid input → `400 VALIDATION_ERROR` with `details` (Zod issues). Never trust the client.

---

## 5. Auth & multi-tenancy

- **JWT:** `accessToken` (short-lived, ~1h) + `refreshToken` (long-lived). Response shape matches the frontend `Tokens` type: `{ accessToken, refreshToken, expiresAt }` (`expiresAt` = ms epoch).
- `authenticate` middleware verifies the access token → sets `req.user` (`{ _id, role, schoolId }`).
- `requireRole(...roles)` gates staff/role-specific routes → `403 FORBIDDEN` on mismatch. Roles use the frontend's `USER_ROLES` set.
- **Tenant scoping is mandatory.** Every school-owned query is filtered by `req.user.schoolId`. A user must never read/write another school's data. `super_admin` is the only cross-tenant role. Add `schoolId` to every tenant-owned model and index it.
- Passwords hashed with **bcrypt**. Never return `passwordHash`.

---

## 6. Errors

- Throw `ApiError(status, code, message, details?)`; the central error handler formats it. Never `res.status().json()` an error inline.
- Async controllers are wrapped so rejections reach the error handler.
- 404 for unknown routes via the `notFound` middleware.
- Known codes: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `INTERNAL` (500).

---

## 7. Data layer

- One Mongoose **model per entity**: `modules/<domain>/<entity>.model.ts`. Schema with `timestamps: true`, tenant `schoolId` where applicable, sensible indexes, and a `toJSON` transform that stringifies `_id` and drops `__v`/secrets.
- Business logic lives in a **service** (`<domain>.service.ts`); controllers stay thin (parse → call service → send). Reuse services across domains (e.g. fee reads students).
- Relations by `ObjectId` refs; populate only what the response needs.
- Seed script (`seed/`) creates the demo school + the frontend's demo accounts so existing flows work end-to-end.

---

## 8. Testing (non-negotiable — "100%")

- **Every endpoint has an integration test** (Supertest against the real Express app on an ephemeral `mongodb-memory-server`).
- Each test asserts: (a) status code, (b) the **response body shape matches the frontend type** (every field the client reads is present and correctly typed), (c) auth/role gating (401/403), (d) tenant isolation (school A cannot see school B), (e) validation rejects bad input.
- A domain is **not done** until its tests are green AND it's wired into the web app and the web `pnpm type-check` passes.
- Run `npm test` (all) after each domain; never move on with a red suite.

---

## 9. Definition of done (per domain)

1. Models + indexes.
2. Zod validation for every write.
3. Service + thin controllers.
4. Routes mounted under `/api`.
5. Seed data (if the domain has demo data on the frontend).
6. Integration tests green (status + shape + auth + tenant + validation).
7. Frontend `.api.ts` mock bodies replaced with real `apiClient` calls; `pnpm type-check` + affected tests pass on web.
8. Manual smoke: boot server against local mongod, hit the domain's key endpoints, confirm the web screen renders live data.

---

## 10. Conventions

- TypeScript strict; no `any`; explicit return types on exported functions.
- `camelCase` vars/functions, `PascalCase` types/models, kebab-case files.
- No secrets in code; all config via Zod-validated `config/env.ts`.
- Conventional Commits (`feat(api):`, `fix(api):`, `test(api):`).
- Keep it lazy-correct: reuse the shared lib helpers (`ApiError`, `ok`, `paginate`, `asyncHandler`) — don't re-implement per module.
