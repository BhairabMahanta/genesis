# Backend Migration: Java → TypeScript

**Status:** P0 persistence, P1 integrity/notification parity, and P2 functional validation are complete. The frontend has been validated end-to-end against the real TypeScript API. Remaining authorization/transport hardening is listed in §8.

**Last updated:** 2026-10-20

**Reference:** `legacy/genesis-java/` (read-only). Do not modify the Java tree; use it only to confirm behaviour.

**Target:** `apps/api/` (Hono + Prisma + PostgreSQL).

---

## 1. Outcome

- PostgreSQL is the only persistence backend. The in-memory store has been deleted; there is no fallback path.
- The database schema remains owned by the legacy Flyway migrations `V1`–`V8`. Prisma is a typed query client, not the migration authority.
- Every service and route handler uses async Prisma queries.
- The frontend no longer has a mock mode. It always authenticates and reads/writes the real API.
- The API refuses to start without `DATABASE_URL` and reports `503 DOWN` when the database is unreachable.
- Live notifications are implemented with persistence + SockJS/STOMP fan-out, including workspace member exclusions.
- The application and integration test share the same Hono app (`src/app.ts`); only `src/index.ts` opens a listener.

---

## 2. Runtime architecture

| Concern | Implementation |
|---|---|
| HTTP | Hono 4 (`src/app.ts`) |
| Persistence | Prisma 5 + PostgreSQL |
| Schema | Legacy Flyway `V1`–`V8` (`legacy/genesis-java/genesis-api/src/main/resources/db/migration`) |
| Auth | `jose` HS256 access tokens + rotating refresh tokens (`refresh_tokens`) |
| Passwords | `bcryptjs` |
| Validation | Zod schemas per domain in `src/schemas/` |
| File storage | `local` disk or Cloudinary; local fallback when Cloudinary is not configured |
| Tokenization | In-process async processor (`setImmediate`) |
| Notifications | Persisted rows + SockJS xhr-polling + minimal STOMP broker |
| Tests | Node test runner + `tsx`, exercising `app.request()` against PostgreSQL |

`apps/api/src` layout:

```text
app.ts / index.ts        Hono app (testable) / listener
config.ts, db.ts         Environment + Prisma singleton
routes/                  HTTP layer, one file per domain
services/                Business logic (workspace, document, editor, annotation, export, notifications)
schemas/                 Zod request validation and response DTOs
middleware/              JWT auth, CORS, error envelope
common/                  ApiResponse helpers, HTTP errors, params, cursor pagination
store/prisma.ts          All persistence, cascade cleanup, cluster renumbering, notification fan-out
lib/                     JWT and password helpers
```

Prisma client generation:

```bash
pnpm --filter @genesis/api exec prisma generate
```

No `prisma migrate` / `db push` is used.

---

## 3. Endpoint coverage

All frontend-facing paths keep the legacy URL shape and `ApiResponse<T>` envelope.

| Domain | Routes |
|---|---|
| Auth | `POST /api/auth/signup`, `/login`, `/refresh`, `/logout`; `GET /api/auth/me` |
| Workspaces | `GET/POST /api/workspaces`; `GET/PUT/DELETE /api/workspaces/:id`; `PUT /api/workspaces/:id/status` |
| Members | `GET/POST /api/workspaces/:id/members`; `PUT/DELETE /api/workspaces/:id/members/:userId` |
| Documents | `GET/POST /api/workspaces/:workspaceId/documents`; `GET /count`; `GET/PUT/DELETE /api/documents/:id` |
| Editor | `POST /api/editor/workspaces/:id/open`; documents/content/session/status routes; re-tokenize admin hook |
| Coreference | Mentions, clusters, merge, stats, recommendations/dismissals |
| NER | `GET/POST/DELETE /api/ner-tags`; `GET/POST/PATCH/DELETE /api/ner-annotations` |
| POS | `GET/POST/DELETE /api/pos-tags`; token/batch/document POS routes |
| WSD | Senses, annotations, TSV import/export routes |
| Notifications | `GET /api/notifications`; read/read-all/delete mutations |
| Recommendations | Workspace recommendation list + dismissal routes |
| Export / share | Workspace/document ZIP export; public share download |
| Logs | `GET /api/workspaces/:id/logs` |
| WebSocket | `/ws/info`, SockJS open/poll/send, STOMP subscriptions |
| Ops | `GET /api/health`, `GET /api/version` |

Behavioural notes:

- Notifications accept both `PUT` and `POST` for `read` / `read-all`; the frontend uses `PUT`, matching the Java controller.
- NER intentionally does not write `annotation_log`; the database constraint does not allow `NER_ANNOTATED` / `NER_DELETED`.
- `ExportGeneratedEvent` is never published by the Java listener, so no export-generated notification is emitted.
- Uploads are capped at 50 MB, matching Spring multipart settings.

---

## 4. Persistence and data integrity (P0)

Implemented in `src/store/prisma.ts` and the service layer:

- Audit columns (`created_at`, `created_by`, `updated_at`, `updated_by`) are populated for every insert/update.
- Database `BigInt` file sizes/versions are converted to JSON-safe values at the response boundary.
- Document deletion removes annotation/session children before the document row, then the stored file, respecting `documents.stored_file_id` (`NO ACTION`).
- Workspace deletion reclaims stored objects and documents first, then deletes the workspace, memberships, and remaining dependent rows.
- Coreference cluster deletion renumbers the surviving clusters to a contiguous `1..N`.
- Cluster merge validates both clusters belong to the same workspace, repoints mentions from source to target, removes the source cluster, and renumbers.
- Notification mutations are scoped by recipient: reading/deleting another user's notification returns `404`.
- Health checks query PostgreSQL; `/api/health` returns `503` and `status: "DOWN"` when the check fails.

Post-P1 orphan checks all returned zero for: sentences, tokens, coref mentions, coref clusters, NER annotations, POS annotations, WSD annotations, workspace members, annotation logs, editor sessions, WSD senses, and unreferenced stored files.

---

## 5. Notifications and WebSocket parity (P1)

Notification titles, messages, types, and links mirror the Java `NotificationEventListener`:

| Event | Notification behaviour |
|---|---|
| Workspace created | Owner receives “Workspace Created” |
| Workspace deleted | Each member receives “Workspace Deleted” pointing to `/home`; workspace id cleared |
| Member added | New member gets “Added to Workspace”; admin gets “Member Added”; other members get informational fan-out |
| Member removed | Removed member gets “Removed from Workspace” pointing to `/home` |
| Document uploaded | Uploader gets “Document Uploaded” |
| Document deleted | Deleter gets a success notification; other members get a warning |
| Document processing complete | Uploader/actor gets “Document Processing Complete” |
| Annotation complete | Workspace owner/actor receives “Annotation Complete” |
| Processing failure | Uploader receives “Document processing failed” |

Delivery:

- `saveNotification` persists the row and immediately pushes it to every active STOMP session for the recipient.
- Workspace fan-out supports `excludeUserIds`, so the actor/new member does not receive duplicate notifications.
- STOMP destination: `/user/queue/notifications`; the client subscribes with `@stomp/stompjs`.
- SockJS `/ws/info` advertises `websocket: false`. This server implements **xhr-polling only**; the frontend forces `transports: ['xhr-polling']` to avoid failed native-WebSocket/eventsource/iframe attempts.
- `POST /ws/:server/:session/xhr` distinguishes the first open request (`o\n`) from later receive polls (queued frames or heartbeat). This was required for STOMP CONNECT to complete.
- Broker sessions are in-memory; clients reconnect with `reconnectDelay: 5000` after a restart.
- Verified in the browser: “Connected to Notification WebSocket”, live notification received while the page remained open, no console errors or 404s.

---

## 6. Frontend integration

- Mock mode was removed completely:
  - Deleted `apps/web/src/server/mock-data.ts`.
  - Removed `IS_MOCK_MODE`, `NEXT_PUBLIC_MOCK_MODE`, `dev:mock`, mock branches/imports, mock workspaces/documents/notifications, the “Mock Mode Active” footer, and fake collaborator avatars.
  - Middleware, root page, auth actions, document/workspace/notification gateways now always use the API.
- `WorkspaceShell` now:
  - Mirrors refreshed RSC props into local state after `router.refresh()`.
  - Updates document counts immediately after upload/delete.
- Real-browser smoke validated against the TS API:
  - Signup and login through Server Actions.
  - Create workspace through the UI.
  - Upload a text document, wait for processing, see it in the document list.
  - Open the editor and render tokenized text.
  - Notification list includes workspace/document/processing events.
  - Live push: a workspace created via the API while the page was open appeared over STOMP.
  - Workspace ZIP export through the Next route handler.
  - Logout and middleware protection of `/home`.
  - No console errors and no 404s after forcing xhr-polling.

> **Mock-mode policy:** removal is intentional. A remote feature commit extending mock mode (`0a19be9`) was dropped during the 2026-10-20 merge. Do not reintroduce `IS_MOCK_MODE`, `NEXT_PUBLIC_MOCK_MODE`, `apps/web/src/server/mock-data.ts`, or mock gateway branches; they conflict with the real-API architecture.

---

## 7. Validation evidence

| Check | Result |
|---|---|
| API TypeScript (`pnpm --filter @genesis/api typecheck`) | Pass |
| Web TypeScript (`pnpm --filter @genesis/web exec tsc --noEmit`) | Pass |
| Production build (`pnpm build`) | Pass (`NEXT_PUBLIC_API_URL`/`INTERNAL_API_URL` set; `NEXT_STANDALONE=false` on this Windows host; Docker keeps standalone) |
| Built API production-mode startup (`NODE_ENV=production`, port 8100) | `/api/health` UP, database true |
| API integration suite (`pnpm --filter @genesis/api test`) | 10/10 pass |
| Dev launcher (`pnpm dev`) | API `8099` + web `3000`, `[BACKEND]`/`[FRONTEND]` logs, `/api/health` UP |
| P2 validation: undefined NER label, out-of-bounds/reversed NER spans, undefined POS tag (single + batch), custom tag lifecycle | Pass |
| Endpoint inventory vs Java controllers | 83/83 present; 12 intentional extras (SockJS, version, aliases) |
| Existing development DB read-only integrity (orphan documents/tokens/POS annotations) | 0 orphans; existing POS tags valid |
| Manual real-mode API smoke (auth, refresh/logout, workspaces/members, upload/tokenization, document CRUD/status, editor, NER, coref, POS, WSD, notifications, recommendations, logs, ZIP export, share download) | 34/34 pass |
| P1 smoke: cluster delete 1,2,3 → 1,2 | Pass |
| P1 smoke: merge validation, renumber, mention repoint | Pass |
| P1 smoke: cross-user notification read/delete → 404 | Pass |
| P1 smoke: workspace/document cascade + stored-file cleanup | Pass |
| P1 smoke: all notification lifecycle events | Pass |
| Orphan checks (12 tables/files) | All zero |
| Restart persistence (workspace survives API restart) | Pass |
| Playwright frontend smoke (11 flows, real API) | Pass |
| Browser console/network after xhr-polling fix | No errors/404s |

Environment note: the API's raw code default is port `8080`, but this machine’s `PEMHTTPD-x64` (Apache) already owns `0.0.0.0:8080` and cannot be stopped without administrator rights. Local development now uses `pnpm dev`, whose launcher defaults to `API_PORT=8099` / `WEB_PORT=3000`, sets both frontend API URLs, and prints `[BACKEND]`/`[FRONTEND]` logs. Running on 8080 works when the port is free.

Reproduce:

```bash
pnpm --filter @genesis/api test
pnpm --filter @genesis/api typecheck
pnpm --filter @genesis/web exec tsc --noEmit
```

The API test suite requires PostgreSQL but starts no listener; it cleans up its users, workspaces, notifications, tag definitions, and stored files.

---

## 8. Remaining hardening (post-P2)

Functional P2 validation is complete. The items below are authorization or transport hardening and do not block the validated frontend flows:

1. **Tag mutation authorization (deferred)** — workspace-scoped tag creation now validates the workspace and requires membership, but global tag creation/deletion and tag deletion still lack admin/creator checks. This is intentionally deferred as low priority for the current single-team deployment; it should be added before a public multi-tenant release. Applies to NER and POS.
2. **Optional transport hardening** — native WebSocket transport is not implemented; xhr-polling is the supported SockJS transport. Add native WebSocket only if a deployment needs it.
3. **Optional durable processing** — tokenization runs in-process. A crash while a document is `PENDING` leaves it stranded until re-tokenized via the admin hook. The Java service was also in-process, so this is not a regression.
4. **Production storage** — Cloudinary requires all three credentials; local storage is the documented development path.

Resolved in this pass:

- NER create/update validates labels against built-in OntoNotes tags plus global/workspace definitions, normalizes case, and checks `endTokenIndex >= startTokenIndex` and document token bounds on both create and update.
- POS single and batch updates require a defined built-in/global/workspace POS tag.
- NER/POS custom tag creation validates the `^[A-Z][A-Z0-9_]{0,19}$` pattern, rejects built-in conflicts and duplicates, and requires a real workspace for `WORKSPACE` scope.
- Tests cover undefined labels, out-of-bounds and reversed spans, undefined POS tags, custom tag creation, duplicate/built-in tag rejection, and the valid paths.

---

## 9. Checklist

### P0 — Persistence
- [x] PostgreSQL schema V1–V8 applied
- [x] Prisma client generated from the existing schema
- [x] In-memory store deleted; no fallback
- [x] All services/routes async
- [x] Audit columns and Date/BigInt mapping
- [x] `/api/health` reflects database state

### P1 — Integrity, notifications, validation
- [x] FK-safe document/workspace deletion and stored-file cleanup
- [x] Coref cluster delete/merge renumbering
- [x] Notification ownership-scoped mutations
- [x] Notification event parity with Java listener
- [x] Workspace fan-out with exclusions
- [x] STOMP push on notification save
- [x] SockJS xhr open/poll distinction
- [x] Frontend forced xhr-polling; no native-WebSocket errors
- [x] Live notification push verified in the browser
- [x] Orphan checks zero
- [x] Restart persistence verified

### P2 — Validation and hardening
- [x] NER label and span validation
- [x] POS tag definition validation for single and batch updates
- [x] Custom NER/POS tag definition validation (pattern, built-in conflict, duplicates)
- [ ] NER/POS tag authorization (deferred; workspace-scoped creation requires membership)
- [ ] Optional native WebSocket transport
- [ ] Optional durable processing/retry queue
- [ ] Production Cloudinary credential validation

### Release gates
- [x] API and web typecheck
- [x] API integration smoke suite
- [x] Real-browser end-to-end smoke
- [x] Frontend mock mode removed
- [x] Setup/README updated for the real stack
- [ ] P2 items above (can ship without them; required before a public multi-tenant release)
