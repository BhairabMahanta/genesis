# Genesis API — Backend Guide

The active backend for Genesis, a multi-task NLP annotation platform. It serves the same HTTP API shape as the original Java/Spring backend, so the Next.js frontend in `apps/web` works unchanged.

If you only read one section, read **Start here** and **How the matching works**. Those two explain 80% of the system.

---

## Contents

1. [Start here: the 60-second version](#1-start-here-the-60-second-version)
2. [Stack and boundaries](#2-stack-and-boundaries)
3. [Source map](#3-source-map)
4. [Boot sequence and configuration](#4-boot-sequence-and-configuration)
5. [Cross-cutting conventions](#5-cross-cutting-conventions)
6. [Auth and sessions](#6-auth-and-sessions)
7. [Data model](#7-data-model)
8. [Feature flows](#8-feature-flows)
9. [How the matching works](#9-how-the-matching-works)
10. [Frontend integration](#10-frontend-integration)
11. [Environment variables](#11-environment-variables)
12. [Run, test, validate](#12-run-test-validate)
13. [Known limitations and deferred hardening](#13-known-limitations-and-deferred-hardening)
14. [Troubleshooting](#14-troubleshooting)
15. [Glossary](#15-glossary)
16. [Where to change what](#16-where-to-change-what)

---

## 1. Start here: the 60-second version

Genesis lets a team upload documents and annotate them with one of four NLP tasks:

| Task | What an annotation is |
|---|---|
| **COREF** | A *mention* (a token span) assigned to a *cluster* of mentions that refer to the same entity. Clusters are workspace-wide. |
| **NER** | A token span labelled with an entity tag such as `PERSON`, `ORG`, or a custom workspace tag. |
| **POS** | A part-of-speech tag attached to one token, one vote per annotator. |
| **WSD** | A sense (from a workspace sense inventory) attached to one token, one vote per annotator. |

A **workspace** owns one annotation type, its documents, its members, and all annotations for those documents.

The normal lifecycle is:

```text
sign up / log in
      |
create workspace (COREF | NER | POS | WSD)
      |
upload document(s)                  <- stored on disk or Cloudinary
      |
background tokenizer                <- sentences + tokens created
      |
open editor                         <- read paginated tokens
      |
annotate                            <- spans / clusters / tags / senses
      |
progress updates + notifications
      |
recommendations, activity log, CoNLL export or share link
```

Key facts:

- **PostgreSQL is the only application database.** There is no mock mode, no in-memory store, and no offline fallback. Uploaded source files live in local disk or Cloudinary.
- **The frontend does not talk to most API endpoints directly.** Next.js server code (RSC and Server Actions) calls this API with a Bearer token read from an HttpOnly cookie.
- **Browser-originated traffic outside ordinary RSC/Server Action responses is limited to** the SockJS/STOMP notification socket, the public share-download URL, and the Next route handler that proxies export downloads.
- **Tokenization and file processing are asynchronous.** Upload returns without waiting for processing; the new document starts in `processingStatus: "PENDING"`, then the tokenizer runs in the same Node process.
- **"Matching" is deterministic.** There is no ML model, fuzzy entity linker, or automatic coreference resolver. Matching means exact string counting, explicit mention-to-cluster assignment, majority voting, validated labels, CoNLL chain parsing, and signed share tokens.

**Feature checklist**

| Capability | Supported | Details |
|---|---|---|
| Signup, login, refresh, logout, current user | Yes | [Auth](#6-auth-and-sessions) |
| Workspace CRUD, status, membership, roles | Yes | [Workspaces](#81-workspaces-and-members) |
| Text and CoNLL document upload | Yes | [Documents](#82-documents-and-tokenization) |
| Background sentence segmentation and tokenization | Yes | [Documents](#82-documents-and-tokenization) |
| Paginated editor content and resume sessions | Yes | [Editor](#83-editor) |
| Coreference mentions, clusters, merge, stats | Yes | [Coreference](#84-coreference) |
| NER tags and span annotations | Yes | [NER](#85-ner) |
| POS tags, per-token votes, majority | Yes | [POS](#86-pos) |
| WSD senses, per-token votes, TSV exports | Yes | [WSD](#87-wsd) |
| Four-rule recommendations and dismissals | Yes | [Recommendations](#88-recommendations-suggestions) |
| Persisted notifications + live STOMP push | Yes | [Notifications](#89-notifications-and-realtime) |
| CoNLL document/workspace export, ZIP, share links | Yes | [Export](#810-export-and-sharing) |
| Workspace activity log | Yes | [Logs](#811-activity-logs) |
| Health and version endpoints | Yes | [Ops](#812-ops) |

---

## 2. Stack and boundaries

| Concern | Implementation |
|---|---|
| HTTP framework | Hono 4 |
| Runtime | Node.js 20+, TypeScript ESM (`tsx` in development) |
| Persistence | Prisma 5 + PostgreSQL 15+ |
| Schema authority | Legacy Flyway SQL `V1`–`V8`; Prisma is a typed client only |
| Auth | JWT HS256 access tokens (`jose`) + rotating opaque refresh tokens |
| Passwords | `bcryptjs` cost 12, with a scrypt fallback if bcrypt is unavailable |
| Validation | Zod schemas per domain |
| File storage | Local disk or Cloudinary |
| Realtime | Hand-rolled SockJS xhr-polling + minimal STOMP broker |
| Tokenization | In-process, fire-and-forget via `setImmediate` |
| Tests | Node test runner, real Hono app, real PostgreSQL |
| Default API port | `8080` directly; `8099` through `pnpm dev` |
| Frontend | `apps/web` (Next.js 15) |

The API's job is deliberately narrow: authenticate, validate, persist, enforce workspace access, process documents, generate recommendations/exports, and push notifications. It does not render UI or run a separate worker process.

The Java/Spring project under `legacy/genesis-java/` is a read-only behavioural reference. The TypeScript API in this directory is the active backend; do not modify the Java tree.

---

## 3. Source map

```text
apps/api/
├── prisma/
│   └── schema.prisma          Typed mirror of the Flyway-owned PostgreSQL schema
├── src/
│   ├── app.ts                 Hono app construction + route mounting (testable)
│   ├── index.ts               Process entry point; opens the listener
│   ├── config.ts              Typed environment reader
│   ├── db.ts                  Prisma singleton + database health check
│   ├── routes/                HTTP layer: validate -> call service -> respond
│   │   ├── auth.routes.ts
│   │   ├── workspace.routes.ts
│   │   ├── document.routes.ts
│   │   ├── editor.routes.ts
│   │   ├── coref.routes.ts
│   │   ├── ner.routes.ts
│   │   ├── pos.routes.ts
│   │   ├── wsd.routes.ts
│   │   ├── recommendation.routes.ts
│   │   ├── notification.routes.ts
│   │   ├── export.routes.ts
│   │   ├── logging.routes.ts
│   │   └── ws.routes.ts
│   ├── services/              Business logic; no Hono types here
│   │   ├── auth.service.ts
│   │   ├── refresh-token.service.ts
│   │   ├── user.service.ts
│   │   ├── workspace.service.ts
│   │   ├── document.service.ts
│   │   ├── editor.service.ts
│   │   ├── coref.service.ts
│   │   ├── ner.service.ts
│   │   ├── pos.service.ts
│   │   ├── wsd.service.ts
│   │   ├── recommendation.service.ts
│   │   ├── recommendation-hash.ts
│   │   ├── stop-words.ts
│   │   ├── notification.service.ts
│   │   ├── stomp-broker.ts
│   │   ├── export.service.ts
│   │   ├── conll-parser.ts
│   │   ├── conll-exporter.ts
│   │   ├── import.service.ts
│   │   ├── annotation-log.service.ts
│   │   ├── zip.ts
│   │   ├── storage/           Local and Cloudinary storage adapters
│   │   └── tokenizer/         Sentence segmenter, Unicode tokenizer, async processor
│   ├── schemas/               Zod request schemas + response DTO interfaces
│   ├── middleware/            JWT auth, CORS, global error/404 handlers
│   ├── common/                ApiResponse envelope, HTTP errors, cursor pages, params
│   ├── store/
│   │   ├── prisma.ts          All database access + notification fan-out
│   │   └── types.ts           Stable entity types used by services
│   └── lib/                   JWT signing/verification, password hashing
└── test/
    └── api.smoke.test.ts      Integration smoke suite against PostgreSQL
```

**Layering rule:** routes do HTTP concerns (status codes, query params, Zod); services do business rules; `store/prisma.ts` does database access. If you are tracing behaviour, start at the route, then the service, then the store function.

---

## 4. Boot sequence and configuration

### 4.1 Construction vs listening

`src/app.ts` constructs the Hono application and mounts all route groups. `src/index.ts` is the only file that opens a port.

This split exists so the integration test can do:

```ts
import app from "../src/app.js";
await app.request("/api/health");
```

without binding a port.

### 4.2 Startup checks

At import time:

1. `config.ts` reads and validates the environment.
   - `JWT_SECRET` is required in production and must be at least 32 characters.
   - CORS origins are required in production.
   - Duration values accept `15m`, `7d`, `900s`, `3600000`, or ISO-8601 like `PT15M`.
2. `db.ts` refuses to start if neither `DATABASE_URL` nor `DB_URL` is set.
3. `getStorage()` lazily selects local disk or Cloudinary. If Cloudinary is requested but not configured, it logs a warning and falls back to local disk.
4. `index.ts` starts the listener and logs the URL.

### 4.3 Database schema

The schema is **not** managed by Prisma migrations. Apply the legacy Flyway files in order:

```text
legacy/genesis-java/genesis-api/src/main/resources/db/migration/V1__baseline.sql
...
V8__wsd_annotation_document_id.sql
```

Then generate the client:

```bash
pnpm --filter @genesis/api exec prisma generate
```

Do not run `prisma migrate` or `prisma db push`; they would diverge from the Flyway schema.

### 4.4 Mount points

| Mount | Router |
|---|---|
| `/api/auth` | `auth.routes.ts` |
| `/api/workspaces` | `workspace.routes.ts` |
| `/api` | documents, editor, coref, POS, WSD, export, recommendations, logs, share export |
| `/api/ner-tags` | NER tag definitions |
| `/api/ner-annotations` | NER annotations |
| `/api/pos-tags` | POS tag definitions |
| `/api/notifications` | notifications |
| `/ws` | SockJS/STOMP |

All handlers are mounted on `app.ts`; there are no separate servers.

---

## 5. Cross-cutting conventions

### 5.1 Response envelope

Almost every JSON endpoint returns:

```json
{
  "success": true,
  "data": { },
  "message": "Human-readable message",
  "timestamp": "2026-10-27T12:00:00.000Z"
}
```

Errors:

```json
{
  "success": false,
  "message": "Validation failed",
  "timestamp": "2026-10-27T12:00:00.000Z",
  "fieldErrors": {
    "email": ["Invalid email"]
  }
}
```

The frontend expects this shape and unwraps `data`.

Exceptions: `GET /api/health` returns a plain status object, export/TSV endpoints return file bytes, and the WebSocket routes speak SockJS/STOMP rather than JSON.

### 5.2 HTTP status mapping

| Status | Used for |
|---|---|
| `200` | Normal reads and most mutations |
| `201` | Signup, workspace creation, member add, document upload |
| `204` | Coreference mention/cluster delete, editor session close |
| `400` | Validation failure, invalid state, expired/invalid refresh token |
| `401` | Missing/invalid JWT; **also used when the caller is not a workspace member** |
| `403` | Authenticated but not an admin; disabled/locked account |
| `404` | Resource missing, or a notification belonging to another user |
| `413` | Upload larger than 50 MB |
| `500` | Unhandled server error |
| `503` | Health check when the database is unreachable |

Note the 401/403 split: `requireMember` throws 401 ("You are not a member of this workspace"), while `requireAdmin` throws 403 ("Admin role required") for a member who is not an admin.

### 5.3 Authentication and authorization

- **Authentication** is the `authMiddleware`: `Authorization: Bearer <jwt>`.
- **Membership** is checked per resource by `requireMember(workspaceId, userId)`.
- **Admin** is checked by `requireAdmin(workspaceId, userId)`.
- Roles stored are `ADMIN`, `ANNOTATOR`, `CURATOR`. The current code only distinguishes `ADMIN` from everyone else; `CURATOR` and `ANNOTATOR` have the same effective permissions.
- The workspace owner is a member with `ADMIN` and cannot be removed or demoted.
- Some tag operations are intentionally less strict (see limitations).

### 5.4 CORS

`CORS_ALLOWED_ORIGINS` is a comma-separated allow-list. No wildcards. Credentials are allowed, `Content-Disposition` is exposed (so the export filename can be read), and preflight results are cached for one hour.

### 5.5 Upload limits

- Global Hono `bodyLimit` and an explicit per-upload check both enforce **50 MB**.
- The multipart field must be named `file`.
- The stored content type is inferred from the filename (`.txt`/`.conll` -> `text/plain`, otherwise `application/octet-stream`) when the browser does not supply one.

### 5.6 Pagination

| Endpoint | Style | Defaults / limits |
|---|---|---|
| `GET /api/workspaces/:id/mentions` | Cursor page | limit 100, max 500; cursor is the last mention id |
| `GET /api/workspaces/:id/clusters` | Cursor page | limit 100, max 500; cursor is the last cluster number |
| `GET /api/editor/.../content` | Page/size | page 0, size 50, max size 500 (sentences page) |
| `GET /api/workspaces/:id/logs` | Page/size | page 0, size 50, max size 200 |

Cursor pages look like:

```json
{
  "items": [],
  "nextCursor": null,
  "pageSize": 100,
  "hasMore": false
}
```

The frontend coref gateway drains cursor pages automatically so the editor can render every mention/cluster.

### 5.7 Time, numbers, and auditing

- PostgreSQL `timestamptz` values are mapped to ISO-8601 strings at the response boundary.
- `BigInt` file sizes are converted to JavaScript numbers.
- Audit columns (`created_at`, `created_by`, `updated_at`, `updated_by`, `version`) exist on most tables. The TypeScript store fills them, mostly with `"system"` for system-written rows and the user/annotator id for annotation rows.
- `version` is stored but is **not** used for optimistic locking. There is no conditional update on version.

### 5.8 Error handling

`app.onError` converts `HttpException` subclasses into the error envelope; everything else becomes a generic 500. `app.notFound` returns a 404 envelope rather than HTML.

---

## 6. Auth and sessions

### 6.1 Endpoints

| Method | Path | Auth | Behaviour |
|---|---|---|---|
| `POST` | `/api/auth/signup` | Public | Creates a `LOCAL` user, returns the public user object (no tokens). |
| `POST` | `/api/auth/login` | Public | Accepts `usernameOrEmail` + `password`, returns access + refresh tokens. |
| `POST` | `/api/auth/refresh` | Public (body token) | Rotates the refresh token and issues a new access token. |
| `POST` | `/api/auth/logout` | Public (body token) | Revokes the refresh token; returns success even if it was already invalid. |
| `GET` | `/api/auth/me` | Bearer | Returns the current user. |

### 6.2 Signup rules

- `username` 3–50 characters; `email` valid; `password` 6–100; names 1–100; organization optional.
- Duplicate username or email returns a generic message: `Unable to register. Please check your details.` This avoids account enumeration.
- New users are `authProvider: "LOCAL"`, `emailVerified: false`, enabled, unlocked.
- Signup does **not** log the user in. The frontend redirects to `/login?registered=true`.
- There is no email verification, password reset, or OAuth flow in the backend yet.

### 6.3 Login rules

- The identifier matches **username or email**, case-insensitively.
- Invalid credentials -> `401 Invalid credentials`.
- Disabled account -> `403 Account is disabled`.
- Locked account -> `403 Account is locked`.
- Successful login updates `last_login_at`.

### 6.4 Token model

**Access token**

- JWT, HS256.
- Claims: `sub` = username, `userId` = user UUID, `iat`, `exp`.
- Default TTL: 15 minutes (`JWT_ACCESS_TOKEN_EXPIRY`).
- Verified on every protected request and on STOMP CONNECT.

**Refresh token**

- Opaque UUID stored in `refresh_tokens`.
- Default TTL: 7 days (`JWT_REFRESH_TOKEN_EXPIRY`).
- Rotated on every refresh: old row is revoked, a new row is inserted.
- Revoked or expired tokens are rejected.
- Logout revokes the presented token.

### 6.5 Frontend session architecture (important)

The browser never stores tokens in `localStorage`. The Next.js server owns them in two HttpOnly cookies:

| Cookie | Contents | Lifetime |
|---|---|---|
| `genesis_access_token` | JWT access token | `expiresIn` from the API (default 900 s) |
| `genesis_refresh_token` | Opaque refresh token | 30 days in the cookie |

The server-side refresh token still expires after 7 days by default, so the cookie lifetime is only an upper bound; the API decides whether the token is still valid.

Flow:

1. `loginAction` posts credentials to the API and sets both cookies.
2. Protected Next routes are guarded by `apps/web/src/middleware.ts`.
3. If the access cookie is missing but a refresh cookie exists, middleware calls `POST /api/auth/refresh`, then writes the rotated cookies onto both the forwarded request and the response.
4. If the refresh response is rejected, middleware clears both cookies and redirects to `/login`. If the API is unreachable, it redirects to `/login` but leaves the cookies in place so a later retry can refresh.
5. If a server-side fetch gets a `401` mid-render, `serverFetch` throws `SessionExpiredError`; the page redirects to `/api/auth/end-session`, which clears cookies and redirects to `/login` (RSC cannot mutate cookies itself).

This is why most backend calls must be made from the Next server, not the browser: JavaScript cannot read the HttpOnly cookie directly (the STOMP client gets a copy through a Server Action).

---

## 7. Data model

### 7.1 Relationship overview

```text
users
  |-- refresh_tokens
  |-- workspace_members -------- workspaces
  |                                  |-- documents ---- stored_files
  |                                  |     |-- sentences
  |                                  |     |-- tokens ---- pos_annotations
  |                                  |     |            ---- wsd_annotation
  |                                  |     |-- coref_mentions ---- coref_clusters
  |                                  |     |-- ner_annotations
  |                                  |     |-- wsd_annotation
  |                                  |-- coref_clusters (workspace-scoped numbering)
  |                                  |-- wsd_sense
  |                                  |-- editor_sessions
  |                                  |-- annotation_log
  |                                  |-- notifications
  |                                  |-- dismissed_recommendations
  |                                  |-- ner_tag_definitions (optional workspace scope)
  |                                  |-- pos_tag_definitions (optional workspace scope)
```

### 7.2 Tables

| Table | Purpose | Important columns |
|---|---|---|
| `users` | Accounts | username, email, password hash, enabled, account_locked, auth_provider |
| `refresh_tokens` | Rotating refresh sessions | token, user_id, expiry_date, revoked |
| `workspaces` | Annotation project | name, annotation_type, status, owner_id |
| `workspace_members` | Membership + role | workspace_id, user_id, role |
| `stored_files` | Uploaded source files | public_id, url, original_filename, content_type, file_size |
| `documents` | One text/CoNLL file in a workspace | order_index, status, processing_status, token_start/end_index, stored_file_id |
| `sentences` | Sentence rows | document_id, sentence_index, text, start/end_offset |
| `tokens` | Token rows | document_id, sentence_index, token_index, global_index, form, pos, lemma, ner_tag |
| `coref_clusters` | Entity clusters | workspace_id, cluster_number (unique per workspace), label, color |
| `coref_mentions` | Mention spans | document_id, cluster_id (nullable), sentence_index, start/end_token_index, global_start/end_index, text |
| `ner_tag_definitions` | Built-in/custom NER tags | tag, scope (`GLOBAL`/`WORKSPACE`), workspace_id |
| `ner_annotations` | NER spans | document_id, start/end_token_index, label, annotator_id |
| `pos_tag_definitions` | Built-in/custom POS tags | tag, scope, workspace_id |
| `pos_annotations` | One POS vote per token per annotator | token_id, document_id, annotator_id, pos_tag (unique: token+annotator) |
| `wsd_sense` | Workspace sense inventory | workspace_id, word, sense_label, gloss, examples |
| `wsd_annotation` | One sense vote per token per annotator | token_id, sense_id, document_id, annotator_id (unique: token+annotator) |
| `dismissed_recommendations` | Per-user hidden suggestions | user_id, recommendation_hash, accepted (unique: user+hash) |
| `editor_sessions` | Resume position | workspace_id, user_id, last_document_index, scroll_position (unique: workspace+user) |
| `annotation_log` | Activity feed | workspace_id, user_id, action_type, entity_id, payload_json, timestamp |
| `notifications` | Persisted notifications | recipient_id, actor_id, workspace_id, title, message, type, read, link |

### 7.3 Schema/Prisma naming

The Prisma models map to legacy table names with `@@map`: `users`, `workspaces`, `coref_clusters`, `ner_annotations`, etc. Some models use PascalCase (`User`, `Workspace`, `Document`); legacy tables use exact snake_case model names (`coref_mentions`, `wsd_annotation`). This is intentional; the schema was reverse-engineered from Flyway SQL.

### 7.4 Cascade and cleanup behaviour

- Deleting a **document** first deletes the external stored object (when present), then deletes the document row. Sentences, tokens, coref mentions, NER annotations, POS annotations, and WSD annotations cascade from the document/token foreign keys.
- Deleting a **workspace** deletes its documents one by one (reclaiming stored files and emitting document-deleted notifications), then removes members and the workspace. Most remaining children cascade.
- Deleting a **cluster** unassigns its mentions (`cluster_id = NULL`), deletes the cluster, then renumbers the surviving clusters to a contiguous `1..N`.
- Deleting a **token** (via re-tokenization) cascades POS and WSD annotations for that token. NER annotations reference the document, not the token, so they are not removed by re-tokenization.
- Deleting a **stored file** is done explicitly by the service, not by a database cascade.
- Deleting a **user** is not exposed as an API operation.

---

## 8. Feature flows

### 8.1 Workspaces and members

**Endpoints**

| Method | Path | Access |
|---|---|---|
| `POST` | `/api/workspaces` | Authenticated |
| `GET` | `/api/workspaces` | Authenticated; returns workspaces the user belongs to |
| `GET` | `/api/workspaces/:id` | Member |
| `PUT` | `/api/workspaces/:id` | Admin |
| `PUT` | `/api/workspaces/:id/status?status=DRAFT\|ACTIVE\|ARCHIVED` | Admin |
| `DELETE` | `/api/workspaces/:id` | Admin |
| `GET` | `/api/workspaces/:id/members` | Member |
| `POST` | `/api/workspaces/:id/members` | Admin; body `{ email, role }` |
| `PUT` | `/api/workspaces/:id/members/:userId?role=...` | Admin |
| `DELETE` | `/api/workspaces/:id/members/:userId` | Admin |

**Creation flow**

1. Validate `name`, optional `description`, and `annotationType` (`COREF`, `NER`, `POS`, `WSD`).
2. Reject a duplicate name for the same owner, case-insensitively.
3. Insert the workspace with status `DRAFT`.
4. Insert the creator as an `ADMIN` member.
5. Persist and push a "Workspace Created" notification to the creator.

**Response shape**

The workspace response is computed live:

```json
{
  "id": "…",
  "name": "…",
  "description": null,
  "annotationType": "COREF",
  "status": "DRAFT",
  "ownerId": "…",
  "ownerUsername": "…",
  "documentCount": 4,
  "annotatedDocumentCount": 1,
  "progressPercentage": 25,
  "createdAt": "…",
  "updatedAt": "…"
}
```

`annotatedDocumentCount` counts documents whose `status` is `COMPLETE`; `progressPercentage` is `round(complete / total * 100)`.

**Member rules**

- The creator is the owner (`workspaces.owner_id`) and an admin.
- Adding a member requires the target user to already have an account with that exact email (case-insensitive).
- The owner cannot be removed or have their role changed.
- `CURATOR` is accepted but not differentiated from `ANNOTATOR` in authorization checks.
- Removing a member only removes membership; their annotations remain.

**Delete flow**

A workspace delete is intentionally heavy:

1. For every document: delete the stored file, delete the document row, notify the acting admin of success, and notify other members with a warning.
2. Delete the workspace (documents and members are removed explicitly because those foreign keys are `NO ACTION`).
3. Notify every member that the workspace was deleted. These notifications have `workspaceId: null` and link to `/home`.

The frontend only shows the delete action to admins.

### 8.2 Documents and tokenization

**Endpoints**

| Method | Path | Access |
|---|---|---|
| `POST` | `/api/workspaces/:workspaceId/documents` | Member; multipart field `file` |
| `GET` | `/api/workspaces/:workspaceId/documents` | Member |
| `GET` | `/api/workspaces/:workspaceId/documents/count` | Member |
| `GET` | `/api/documents/:id` | Member |
| `PUT` | `/api/documents/:id/status?status=UPLOADED\|IMPORTED\|ANNOTATING\|COMPLETE` | Member |
| `DELETE` | `/api/documents/:id` | Admin |
| `POST` | `/api/editor/documents/:documentId/tokenize` | **No auth** (legacy admin hook) |

**Upload flow**

1. Verify membership and the document extension (`.txt`, `.text`, `.conll`,
   `.conll2012`). Spreadsheets are rejected here; use the WSD sense importer.
2. Decode the text (UTF-8, UTF-8 BOM, UTF-16LE/BE with or without BOM, or
   windows-1252), reject content that still looks binary, and normalize to
   UTF-8 so tokenization is encoding-independent.
3. Upload bytes through `StorageService`:
   - `local`: writes to `STORAGE_LOCAL_BASE_PATH` (default `./data/uploads` relative to `apps/api`).
   - `cloudinary`: uploads to the configured cloud.
4. Insert a `stored_files` row.
5. Insert the document with:
   - `orderIndex = MAX(order_index) + 1` in the workspace,
   - `status = "UPLOADED"`,
   - `processingStatus = "PENDING"`,
   - `progress = null`.
6. Persist and push notifications:
   - uploader: "Document Uploaded" (success),
   - other members: "Document Uploaded" (info).
7. Return the document without waiting for tokenization.
8. `processDocumentAsync` schedules `processDocument` via `setImmediate`.

**Processing flow**

```text
PENDING -> PROCESSING -> COMPLETED
                      \-> FAILED (error stored, truncated to 900 chars)
```

`processDocument`:

1. Downloads the stored content and decodes it (normalized to UTF-8 on upload;
   stored legacy files are decoded on read).
2. Chooses a path:
   - **CoNLL**: filename ends with `.conll`/`.conll2012`, or the content starts with `#begin document`.
   - **Plain text**: segment into sentences, then tokenize.
   - **Empty**: store zero sentences/tokens.
3. `replaceDocumentContent` deletes existing sentence/token rows for the document and inserts the new ones in one transaction.
4. Computes the workspace-continuous token range:
   - `tokenStartIndex` = total tokens in all earlier documents (`orderIndex` lower),
   - `tokenEndIndex = tokenStartIndex + tokenCount - 1`.
5. Marks `COMPLETED`, clears any prior error.
6. Optionally reclaims the raw source file when `STORAGE_RETAIN_SOURCE=false`:
   - sets `stored_file_id = NULL`,
   - deletes the storage object and the `stored_files` row.
7. Notifies all workspace members: "Document Processing Complete" with a link to the editor.

On failure: sets `FAILED`, stores a truncated error, and notifies all members with "Document processing failed".

**Document status vs processing status**

- `processingStatus` is about tokenization: `PENDING` -> `PROCESSING` -> `COMPLETED`/`FAILED`.
- `status` is the annotation workflow: `UPLOADED`, `IMPORTED`, `ANNOTATING`, `COMPLETE`.
- Upload creates the document as `UPLOADED`.
- The backend does **not** set `IMPORTED` automatically; it is accepted through the status endpoint for workflow compatibility.
- The first coreference mention moves `UPLOADED`/`IMPORTED` to `ANNOTATING`.
- NER, POS, and WSD edits do not change `status` or `progress`; only coreference mention writes call `onMentionAnnotated`.
- `COMPLETE` is set manually through `PUT /api/documents/:id/status?status=COMPLETE`; that also emits an "Annotation Complete" notification.
- Workspace progress counts only documents in `COMPLETE`.

**Sentence segmentation**

`LineSentenceSegmenter` semantics:

- Every line break is a sentence boundary.
- Within a line, a sentence ends at `.`, `?`, `!`, `।`, or `॥` followed by whitespace or end-of-line.
- Offsets are UTF-16 character offsets into the full document.
- Empty lines are skipped.

**Tokenization**

`UnicodeTokenizer` semantics:

- Whitespace separates tokens.
- Runs of letters, digits, and Unicode marks become word tokens.
- ZWNJ/ZWJ join Indic conjuncts into a word.
- Punctuation characters become single-character tokens.
- Symbols and unassigned code points are skipped.
- Offsets are UTF-16 character offsets.
- Supported language codes: `as`, `bn`, `hi`, `brx`, `en`, `mr`, `ne`, `or`, `pa`, `ta`, `te`, `ml`, `kn`, `gu`.

**CoNLL-2012 import**

When the document is CoNLL:

- The parser reads whitespace-separated columns.
- Column 2 is the part number; column 3 is the token index.
- A sentence starts on a blank line or on `tokenIndex == 0`.
- Column 4 is the word, column 5 is POS, column 11 (index 10) is NER, and the last column is coreference.
- Coreference syntax:
  - `(N)` -> single-token mention,
  - `(N` -> mention start,
  - `N)` -> mention end,
  - `A|B` -> multiple annotations on the same token.
- Non-integer cluster ids or non-integer token columns produce a `400`.
- `importConll2012` replaces sentences/tokens, deletes existing mentions for that document, creates one cluster per CoNLL chain id, then creates one mention per span.
- If a chain's original id is already used in the workspace, the next free cluster number is assigned; the original id is kept in the label (`CoNLL #3`).
- Cluster colors are assigned from a fixed palette based on the CoNLL chain id.

**Re-tokenization**

`POST /api/editor/documents/:documentId/tokenize` re-reads the stored file and replaces content. It is unauthenticated for parity with the legacy admin hook. Important consequences:

- POS and WSD annotations on old tokens are cascaded away.
- NER annotations are **not** removed (they are document-scoped), so they can become stale if token boundaries change.
- Coref mentions are not removed by this hook, so they can also become stale if token boundaries change. CoNLL import explicitly deletes mentions first.

### 8.3 Editor

**Endpoints**

| Method | Path | Access |
|---|---|---|
| `POST` | `/api/editor/workspaces/:workspaceId/open` | Member |
| `GET` | `/api/editor/workspaces/:workspaceId/documents` | Member |
| `GET` | `/api/editor/documents/:documentId/content?page=&size=` | Member |
| `GET` | `/api/editor/workspaces/:workspaceId/documents/:documentId/content?page=&size=` | Member |
| `GET` | `/api/editor/workspaces/:workspaceId/session` | Member; 404 if none |
| `POST` | `/api/editor/session` | Member |
| `DELETE` | `/api/editor/workspaces/:workspaceId/session` | Member; 204 |
| `GET` | `/api/editor/workspaces/:workspaceId/status` | Member |
| `POST` | `/api/editor/documents/:documentId/tokenize` | No auth |

**`open` response**

`openWorkspace` returns workspace metadata, a document list with token/sentence counts, the saved session (or `null`), and aggregate totals. The current web editor does not call this endpoint; it assembles the same information from the documents, session, and content endpoints. The endpoint is kept for compatibility.

**Content pagination**

- `page` is a sentence page, not a token page.
- Default `size` is 50; capped at 500.
- The response contains:
  - `sentences`: each with its tokens,
  - `tokens`: flattened page tokens,
  - `totalSentences`, `totalTokens`, `globalTokenOffset`,
  - `currentPage`, `totalPages`, `pageSize`.
- `globalTokenOffset` is the sum of token counts of earlier documents in the workspace. It is used by the UI to show workspace-level positions.
- POS values in the content response are overlaid from the document's POS annotation rows, with the stored token POS as a fallback. This is a display overlay and is separate from the majority-vote endpoint.

The editors load page 0 on mount, then fetch further pages as the user scrolls. NER, POS, and WSD share `usePaginatedDocument`; `CorefEditor` implements the same IntersectionObserver sentinel logic locally.

**Session**

- One session per `(workspace, user)`.
- Stores `lastDocumentIndex` and `scrollPosition`.
- Saved on unmount and after a 1-second scroll debounce.
- Closing deletes the row and returns 204.
- `GET` without a session returns 404; the frontend treats that as "no saved session".

**Status**

`GET .../status` returns document counts, tokenized-document counts, token/sentence totals, and `ready = documents > 0 && every document tokenized`.

### 8.4 Coreference

**Endpoints**

| Method | Path | Access |
|---|---|---|
| `POST` | `/api/workspaces/:workspaceId/mentions` | Member |
| `GET` | `/api/workspaces/:workspaceId/mentions?cursor=&limit=` | Member |
| `GET` | `/api/workspaces/:workspaceId/mentions/unassigned` | Member |
| `GET` | `/api/documents/:documentId/mentions` | Member |
| `GET` | `/api/mentions/:mentionId` | Member |
| `PUT` | `/api/mentions/:mentionId/cluster/:clusterId` | Member |
| `DELETE` | `/api/mentions/:mentionId/cluster` | Member |
| `DELETE` | `/api/mentions/:mentionId` | Member; 204 |
| `POST` | `/api/workspaces/:workspaceId/clusters` | Member |
| `GET` | `/api/workspaces/:workspaceId/clusters?cursor=&limit=` | Member |
| `POST` | `/api/workspaces/:workspaceId/clusters/merge` | Member |
| `GET` | `/api/clusters/:clusterId` | Member |
| `GET` | `/api/clusters/:clusterId/mentions` | Member |
| `PUT` | `/api/clusters/:clusterId` | Member |
| `DELETE` | `/api/clusters/:clusterId` | Member; 204 |
| `GET` | `/api/workspaces/:workspaceId/coref/stats` | Member |

**Mention creation**

```json
{
  "documentId": "uuid",
  "sentenceIndex": 0,
  "startTokenIndex": 3,
  "endTokenIndex": 5,
  "text": "the company",
  "mentionType": "NP",
  "clusterId": "optional uuid"
}
```

Validation and behaviour:

- Caller must be a workspace member.
- Document must exist and belong to the workspace.
- `endTokenIndex >= startTokenIndex`.
- If `clusterId` is supplied, that cluster must belong to the same workspace.
- `globalStartIndex`/`globalEndIndex` are resolved from the document's tokens by looking up `tokenIndex` and storing that token's `globalIndex`. They are **document-level** indices, not workspace-level. Note that `tokenIndex` restarts per sentence, so this lookup can collide across sentences in the same document; treat the stored mention global indexes as best-effort.
- A `MENTION_CREATED` activity log row is written.
- Document progress is recomputed (see below).

**Cluster creation**

- Cluster number is `MAX(cluster_number) + 1` in that workspace.
- Color is chosen from an 8-colour palette based on the current cluster count.
- `label` is optional.
- The response computes `representativeText` (first mention's text) and `mentionCount` live; the legacy `mention_count`/`representative_text` columns are not authoritative.

**Assign / unassign**

- Assignment verifies that the cluster and mention are in the same workspace.
- Assignment writes a `MENTION_ASSIGNED` log and recomputes progress.
- Unassignment sets `cluster_id = NULL` and recomputes progress; it does not write a log entry.
- Deleting a mention writes `MENTION_DELETED` but does **not** recompute progress.

**Merge**

```json
{
  "sourceClusterIds": ["uuid", "uuid"],
  "targetClusterId": "uuid"
}
```

1. Caller must be a member.
2. Target must exist in the workspace.
3. Every source must exist in the workspace.
4. Source ids equal to the target are ignored; at least one distinct source is required.
5. In one transaction:
   - repoint all source mentions to the target,
   - delete the source clusters,
   - renumber all clusters in the workspace to `1..N`.
6. Write a `CLUSTER_MERGED` log.
7. Return the target cluster with recomputed counts.

**Delete cluster**

1. Set all mentions of the cluster to `cluster_id = NULL`.
2. Delete the cluster.
3. Renumber the workspace's clusters to `1..N`.

Renumbering first moves rows into a negative number range, then assigns `1..N`, to avoid collisions with the unique `(workspace_id, cluster_number)` constraint.

**Progress**

`onMentionAnnotated` runs after mention create, assign, and unassign:

- If the document status is `UPLOADED` or `IMPORTED`, move it to `ANNOTATING`.
- `progress = sum(mention span lengths) / (tokenEndIndex - tokenStartIndex + 1)`, capped at 1.
- This is span coverage, not "percentage of mentions assigned".
- Failures are logged and swallowed; the mention write has already committed.

**Stats**

```json
{
  "mentionCount": 12,
  "clusterCount": 4,
  "assignedMentionCount": 9,
  "unassignedMentionCount": 3
}
```

### 8.5 NER

**Endpoints**

| Method | Path | Access |
|---|---|---|
| `GET` | `/api/ner-tags?workspaceId=` | Authenticated |
| `POST` | `/api/ner-tags` | Authenticated |
| `DELETE` | `/api/ner-tags/:definitionId` | Authenticated |
| `GET` | `/api/ner-annotations?documentId=&annotatorId=` | Member |
| `POST` | `/api/ner-annotations` | Member |
| `PATCH` | `/api/ner-annotations/:annotationId` | Member |
| `DELETE` | `/api/ner-annotations/:annotationId` | Member |

**Tag inventory**

Built-in OntoNotes tags:

`PERSON`, `NORP`, `FAC`, `ORG`, `GPE`, `LOC`, `PRODUCT`, `EVENT`, `WORK_OF_ART`, `LAW`, `LANGUAGE`, `DATE`, `TIME`, `PERCENT`, `MONEY`, `QUANTITY`, `ORDINAL`, `CARDINAL`.

Custom tags:

- Scope is `GLOBAL` or `WORKSPACE`.
- Pattern: `^[A-Z][A-Z0-9_]{0,19}$` (max 20 chars).
- Normalized to uppercase.
- Cannot duplicate a built-in tag.
- Cannot duplicate an existing tag in the same scope/workspace.
- `WORKSPACE` scope requires `workspaceId` and membership.
- Listing merges built-ins + global custom tags + the requested workspace's custom tags.

**Annotation rules**

```json
{
  "documentId": "uuid",
  "startTokenIndex": 2,
  "endTokenIndex": 4,
  "label": "ORG"
}
```

- Caller must be a member of the document's workspace.
- `endTokenIndex >= startTokenIndex`.
- `endTokenIndex < tokenCount` (bounds checked).
- `label` must exist in the workspace's effective tag set after uppercasing.
- Multiple overlapping annotations are allowed; the schema has no uniqueness constraint.
- Create and update both validate span and label.
- Updates accept any subset of start, end, label.
- NER does **not** write to `annotation_log`; the database constraint does not allow `NER_ANNOTATED`/`NER_DELETED`.
- The stored `tag_id` is always `null` in the current implementation; labels are stored directly.

### 8.6 POS

**Endpoints**

| Method | Path | Access |
|---|---|---|
| `GET` | `/api/pos-tags?workspaceId=` | Authenticated |
| `POST` | `/api/pos-tags` | Authenticated |
| `DELETE` | `/api/pos-tags/:definitionId` | Authenticated |
| `PUT` | `/api/tokens/:tokenId/pos` | Member |
| `PUT` | `/api/tokens/pos/batch` | Member |
| `GET` | `/api/tokens/:tokenId/pos` | Member |
| `GET` | `/api/documents/:documentId/pos` | Member |
| `GET` | `/api/documents/:documentId/pos/majority` | Member |

**Tag inventory**

Built-ins: `NOUN`, `PROPN`, `VERB`, `ADJ`, `ADV`, `PRON`, `DET`, `ADP`, `CONJ`, `SCONJ`, `AUX`, `NUM`, `PART`, `INTJ`, `SYM`, `PUNCT`, `X`.

Custom tag rules are the same as NER: uppercase pattern, no built-in conflict, unique per scope/workspace, workspace scope requires membership.

**Voting model**

- One row per `(token, annotator)`; a second PUT updates that annotator's vote.
- `pos: null` deletes that annotator's vote.
- Single update body: `{ "pos": "NOUN" }` or `{ "pos": null }`.
- Batch body:

```json
{
  "updates": [
    { "tokenId": "uuid", "pos": "NOUN" },
    { "tokenId": "uuid", "pos": null }
  ]
}
```

- Batch accepts 1–500 updates and applies them sequentially. It is **not** transactional; a validation error after some updates leaves the earlier ones committed.
- Every non-null POS update (including each batch item) writes a `POS_TAGGED` log row; clearing a vote does not.
- `GET /tokens/:tokenId/pos` returns all annotators' votes.
- `GET /documents/:documentId/pos` returns all votes for the document.

**Majority POS**

`GET /api/documents/:documentId/pos/majority` returns:

```json
{
  "token-id": "NOUN",
  "another-token-id": "VERB"
}
```

- Count one vote per annotator per token.
- Highest vote count wins.
- Tie-break: alphabetical by POS tag (`localeCompare`).
- If a token has no votes, fall back to the stored `tokens.pos` value.
- This majority map is used by CoNLL export and the public share export.

### 8.7 WSD

**Endpoints**

| Method | Path | Access |
|---|---|---|
| `GET` | `/api/workspaces/:id/wsd/senses?word=&query=&page=&limit=` | Member; paginated search when query/page/limit is present |
| `POST` | `/api/workspaces/:id/wsd/senses` | Member; create a sense |
| `POST` | `/api/workspaces/:id/wsd/import` | Admin; multipart `.xls`/`.xlsx`/`.xlsm`/`.json`/`.jsonl`/`.csv`/`.tsv` |
| `POST` | `/api/workspaces/:id/wsd/words/match` | Member; check token forms against the list |
| `PUT` | `/api/workspaces/:id/wsd/senses/:senseId` | Admin |
| `DELETE` | `/api/workspaces/:id/wsd/senses/:senseId` | Admin |
| `GET` | `/api/workspaces/:id/wsd/senses/export?format=jsonl\|csv` | Member; dictionary export |
| `POST` | `/api/workspaces/:id/wsd/annotations` | Member |
| `POST` | `/api/workspaces/:id/wsd/rejections` | Member; persist ✗ for a token/sense |
| `DELETE` | `/api/workspaces/:id/wsd/rejections/:tokenId/:senseId` | Member |
| `GET` | `/api/workspaces/:id/wsd/documents/:documentId/rejections` | Member |
| `GET` | `/api/workspaces/:id/wsd/tokens/:tokenId/annotations` | Member |
| `GET` | `/api/workspaces/:id/wsd/documents/:documentId/annotations` | Member |
| `DELETE` | `/api/workspaces/:id/wsd/annotations/:annotationId` | Member |
| `GET` | `/api/workspaces/:id/wsd/export` | Member; TSV download |
| `GET` | `/api/workspaces/:id/wsd/export/consensus` | Member; TSV download |
| `GET` | `/api/workspaces/:id/wsd/export/annotations?format=csv\|xlsx` | Member; occurrence export |
| `GET` | `/api/workspaces/:id/wsd/annotations/:tokenId` | Alias for token annotations |
| `POST` | `/api/workspaces/:id/wsd/annotate` | Alias for annotation create |

**Sense inventory**

- A sense belongs to one workspace.
- `word`, `senseLabel`, `gloss` and `examples` are stored separately.
- Duplicate `(word, senseLabel)` is rejected case-insensitively by the service.
- `?word=` filters case-insensitively. `query`/`page`/`limit` switch to the
  paginated search used by the editor's dictionary pane.
- Any member can create a sense (annotators hit words the dictionary lacks);
  edit, delete and bulk import stay admin-only.
- Deleting a sense cascades its annotations.

**Import**

`POST /wsd/import` accepts either `multipart/form-data` (field `file`) or a JSON
array/`{ entries: [...] }`. Binary Excel templates (`.xls`/`.xlsx`/`.xlsm`) use
the original layout:

```text
Sl No | Assamese Ambiguous Words | Sense1 Assamese | Sense1 English | ...
```

The parser picks the first sheet with a recognized header, ignores helper
sheets, maps the Assamese sense to `senseLabel` and the English text to `gloss`.
Text imports support JSON, JSONL, CSV and TSV with `word`, `senseLabel`/`label`,
`gloss`/`description`/`meaning`, and `examples` aliases. `mode=skip|overwrite`
controls existing `(word, senseLabel)` pairs.

**Growing the inventory from annotation**

`POST /wsd/senses` is member-level, so the editor can create a sense for a word
the dictionary lacks and then confirm it for the token. Edit, delete and bulk
import remain admin-only.

**Document / workspace progress**

For WSD, `documents.progress` is `annotated ambiguous tokens / all ambiguous tokens`,
where a token is ambiguous when its exact form matches a workspace sense word. The
count is distinct tokens, so multiple annotators on the same token do not inflate
progress. It is recomputed on annotation create/delete, rejection that removes an
annotation, and re-tokenization; the first annotation moves the document to
`ANNOTATING`. A WSD workspace's `progressPercentage` is token-weighted coverage across
all documents, with one decimal so the first few tags do not display as 0%.
`annotatedDocumentCount` counts documents with progress > 0 or status `COMPLETE`.
Other task types keep the original completed-document percentage.

**Occurrence export**

`GET /wsd/export/annotations` returns one row per annotation with document,
sentence/token position, token form, sentence text, sense id/label/gloss/examples,
annotator id/display name and timestamp. CSV includes a UTF-8 BOM so Assamese opens
correctly in Excel. `GET /wsd/senses/export` remains the re-importable dictionary
export (JSONL/CSV).

**Annotation**

```json
{
  "tokenId": "uuid",
  "senseId": "uuid",
  "documentId": "optional uuid"
}
```

- Sense must belong to the workspace.
- Token must exist.
- `documentId` is optional; if omitted it is derived from the token.
- One row per `(token, annotator)`; a second POST updates that annotator's sense.
- Writes a `WSD_ANNOTATED` log row.
- Document annotations intentionally include annotations whose `document_id` was null in older data by scanning annotations whose token belongs to the document.

**TSV exports**

Per-annotator:

```text
token_id	word	sense_label	annotator_id
```

Consensus:

```text
token_id	word	sense_label	votes
```

Consensus picks the sense with the most votes per token. Ties are broken by the **latest annotation timestamp**. Tabs/newlines in cells are replaced with spaces.

### 8.8 Recommendations ("suggestions")

**Endpoints**

| Method | Path | Access |
|---|---|---|
| `GET` | `/api/workspaces/:workspaceId/recommendations` | Member |
| `POST` | `/api/workspaces/:workspaceId/recommendations/dismissals` | Member; body `{ hash, accepted }` |
| `POST` | `/api/workspaces/:workspaceId/recommendations/:hash/dismiss` | Member; legacy alias |

Recommendations are computed on every request. Nothing is stored except per-user dismissals.

There are four rules, returned in this order:

1. `UNFINISHED_MENTION` (HIGH) — every mention with no cluster assignment.
2. `DENSITY_GAP` (MEDIUM) — every document with zero mentions.
3. `STRING_MATCH` (LOW) — the top 50 repeated surface forms.
4. `COREF_CHAIN_GAP` (MEDIUM) — clusters that skip documents in their chain.

The response item:

```json
{
  "hash": "sha256 hex",
  "type": "UNFINISHED_MENTION",
  "priority": "HIGH",
  "documentId": "uuid or null",
  "entityId": "uuid or null",
  "tokenStartIndex": 3,
  "tokenEndIndex": 5,
  "reason": "\"the company\" has no cluster assignment."
}
```

**Dismissal matching**

- Hash = `SHA-256(TYPE:documentId:entityId)`, with nulls rendered as empty strings.
- Dismissals are unique per `(user, hash)`.
- `isRecommendationDismissed` ignores its workspace argument; the hash itself is the identity.
- Both `accepted: true` and `accepted: false` hide the card. The flag records whether the user acted on the suggestion; it does not change filtering.
- Dismissals are per user, so two annotators can see different suggestion lists.

The detailed rules are in [How the matching works](#9-how-the-matching-works).

### 8.9 Notifications and realtime

**Endpoints**

| Method | Path | Access |
|---|---|---|
| `GET` | `/api/notifications` | Bearer |
| `PUT` or `POST` | `/api/notifications/:id/read` | Bearer; own notification only |
| `PUT` or `POST` | `/api/notifications/read-all` | Bearer |
| `DELETE` | `/api/notifications/:id` | Bearer; own notification only |

- Lists all notifications for the caller, newest first. No pagination.
- Reading/deleting another user's notification returns `404` (the update/delete is scoped by recipient).
- Both PUT and POST are accepted for read/read-all; the web app uses PUT.
- Notification types are `INFO`, `SUCCESS`, `WARNING`, and `ERROR`.

**Event table**

| Event | Recipients |
|---|---|
| Workspace created | Creator |
| Workspace deleted | Every member; `workspaceId` cleared, link `/home` |
| Member added | New member, the acting admin, and other members (informational) |
| Member removed | Removed member; `workspaceId` cleared, link `/home` |
| Document uploaded | Uploader + other members |
| Document deleted | Deleter + other members |
| Document processing complete | All workspace members |
| Document processing failed | All workspace members |
| Document marked COMPLETE (annotation complete) | All workspace members |

NER, POS, WSD, and coreference edits do not emit notifications.

**Delivery pipeline**

```text
saveNotification()
  -> insert into notifications
  -> pushToUser(recipientId, "/user/queue/notifications", payload)
       -> every live STOMP session for that user, subscribed to that destination
```

If the recipient has no live session, the row stays in the database and appears on the next `GET /api/notifications`.

**SockJS/STOMP surface**

- `GET /ws/info` advertises `websocket: false`.
- `POST /ws/:server/:session/xhr` — first call opens the session and returns `o\n`; later calls long-poll.
- `GET /ws/:server/:session/xhr` — long-poll; returns queued frames or a heartbeat `h` after ~20 seconds.
- `POST /ws/:server/:session/xhr_send` — client STOMP frames (JSON array of strings).
- `GET /ws/:server/:session/websocket` — returns 400; native WebSocket is not implemented.
- STOMP commands handled: `CONNECT`/`STOMP`, `SUBSCRIBE`, `UNSUBSCRIBE`, `DISCONNECT`.
- CONNECT requires `Authorization: Bearer <access token>` as a STOMP header. The token is verified and bound to the session's `userId`.
- Server push destination: `/user/queue/notifications`.
- Broker sessions are in memory. A restart drops them; the client reconnects every 5 seconds.

### 8.10 Export and sharing

**Endpoints**

| Method | Path | Access | Result |
|---|---|---|---|
| `POST` | `/api/export/documents/:documentId` | Member | `.conll` file |
| `POST` | `/api/export/workspaces/:workspaceId` | Member | `.conll` or `.zip` |
| `POST` | `/api/workspaces/:workspaceId/export/share` | Member | `{ token, expiresInSeconds }` |
| `GET` | `/api/public/export/conll/:workspaceId?token=` | Public | Merged `.conll` |

**Options**

```json
{
  "column2Mode": "PART_NUMBER",
  "exportFormat": "SEPARATE_FILES_ZIP",
  "continueSentenceNumbers": true,
  "defaultPartNumber": 0
}
```

- `column2Mode`: `PART_NUMBER` (default) or `SENTENCE_NUMBER`.
- `exportFormat`: `MERGED_SINGLE_FILE`, `SEPARATE_FILES_ZIP` (default), or `SEPARATE_FILES_ZIP_WITH_MERGED`.
- `continueSentenceNumbers`: continue sentence numbering across documents in a workspace export.
- `defaultPartNumber`: value used in column 2 when `column2Mode` is `PART_NUMBER`.

Document export always produces one `.conll` file.

Workspace export:

- `MERGED_SINGLE_FILE` -> one `.conll`.
- `SEPARATE_FILES_ZIP` -> one `.conll` per document.
- `SEPARATE_FILES_ZIP_WITH_MERGED` -> per-document files plus `merged.conll`.
- For ZIP exports, a sidecar `<workspace>_annotators.csv` is added when any POS annotations exist:

```text
document_id,token_id,annotator_count
```

- The ZIP is a stored (uncompressed) standard PKZIP written by `zip.ts`, so no archive dependency is needed.
- Duplicate document filenames get `_2`, `_3`, etc.

**CoNLL output**

12 tab-separated columns:

```text
doc_id  part_or_sentence  token_id  form  pos  parse  lemma  frameset  sense  speaker  ne  coref
```

- Column 2 is the part number or the sentence number, depending on options.
- POS comes from the majority map (with stored token POS fallback).
- Parse is `*`; lemma falls back to the stored lemma; frameset/sense/speaker are `-`.
- NER is the raw stored tag.
- Coref markers use cluster numbers:
  - single token: `(N)`,
  - multi-token: `(N` at the start, `N)` at the end,
  - overlapping annotations on the same token are joined with `|`.
- Document names are sanitized for the header.

**Share links**

- `issueShareToken` creates a 24-hour HS256 JWT with payload `{ workspace_id }`.
- The public download requires no auth header.
- It verifies the signature and expiry, then checks that the token's `workspace_id` matches the URL's workspace id.
- It always exports a **merged single `.conll`** with `PART_NUMBER`/part 0 and continued sentence numbers; no sidecar.
- The frontend builds the public URL directly against the API and renders it for copying.

### 8.11 Activity logs

`GET /api/workspaces/:workspaceId/logs?page=&size=&action_type=&from=&to=`

- Member access.
- Page size capped at 200.
- Filters are applied in memory after fetching the workspace's logs.
- `from`/`to` compare ISO timestamp strings.
- Response:

```json
{
  "content": [
    {
      "id": "uuid",
      "workspaceId": "uuid",
      "userId": "uuid",
      "actionType": "MENTION_CREATED",
      "entityId": "uuid",
      "payloadJson": "{\"documentId\":\"…\"}",
      "timestamp": "2026-10-27T…"
    }
  ],
  "page": 0,
  "size": 50,
  "totalElements": 1,
  "totalPages": 1
}
```

Actions currently written:

| Action | Written by |
|---|---|
| `MENTION_CREATED` | Coreference mention create |
| `MENTION_ASSIGNED` | Mention-to-cluster assignment |
| `MENTION_DELETED` | Mention deletion |
| `CLUSTER_CREATED` | Cluster creation |
| `CLUSTER_MERGED` | Cluster merge |
| `POS_TAGGED` | Every non-null POS update (including batch items) |
| `WSD_ANNOTATED` | WSD annotation |

Notable gaps: NER writes no logs; unassign, cluster rename, and cluster delete do not log.

### 8.12 Ops

| Method | Path | Behaviour |
|---|---|---|
| `GET` | `/api/health` | Runs `SELECT 1`; returns `{ status: "UP", checks: { database: true } }` or `503` with `DOWN`. |
| `GET` | `/api/version` | `ApiResponse` with service name, phase, and timestamp. |

The server also logs requests in development (`API_REQUEST_LOGS`) via Hono's logger.

---

## 9. How the matching works

This is the part most people ask about. In Genesis, "matching" is not one algorithm. It is a set of deterministic joins and votes. Here is every important one.

### 9.1 First, the coordinate system

These indices are easy to confuse:

| Value | Scope | Meaning |
|---|---|---|
| `sentenceIndex` | Document | 0-based sentence number in the document. |
| `tokenIndex` | Sentence | 0-based token number inside its sentence. |
| `globalIndex` | Document | 0-based token number across the whole document. |
| `tokenStartIndex` / `tokenEndIndex` | Workspace | Workspace-continuous token range assigned to a document after processing. |
| `globalTokenOffset` | Workspace | Tokens in earlier documents, returned by the editor content endpoint. |
| `globalStartIndex` / `globalEndIndex` on a mention | Document | The mention's start/end `globalIndex` inside its own document. |

Example:

```text
Workspace order: Document A (100 tokens), Document B (50 tokens)
Document A: tokenStartIndex = 0,   tokenEndIndex = 99
Document B: tokenStartIndex = 100, tokenEndIndex = 149

Inside Document B:
  sentenceIndex = 2
  tokenIndex = 5
  globalIndex = 5          <- document-level
  editor workspace offset = 100
  editor position = 105

A mention covering B tokens 5..7 stores:
  startTokenIndex = 5
  endTokenIndex = 7
  globalStartIndex = 5     <- document-level, NOT 105
  globalEndIndex = 7
```

**All span end indices are inclusive.**

Note: the stored document `tokenStartIndex`/`tokenEndIndex` are assigned when the document finishes processing and are not recalculated when earlier documents are later deleted. The editor's `globalTokenOffset` is computed from the current document list, so it can diverge from the stored document ranges after deletions.

### 9.2 Annotation to token matching

| Annotation | Match key | Validation |
|---|---|---|
| NER span | `document_id` + `start_token_index..end_token_index` | start/end non-negative, end >= start, end < token count, label in effective tag set |
| Coref mention | `document_id` + token span + optional `cluster_id` | end >= start, cluster same workspace, document same workspace; no token-count bound check |
| POS vote | `token_id` + `annotator_id` | token exists, caller is a workspace member, POS tag is defined |
| WSD vote | `token_id` + `annotator_id` | token exists, sense is in the same workspace, document exists/derived |

NER, POS, and WSD are **per-document/per-token** constructs. Coref mentions are per-document spans, but clusters are **workspace-wide**.

### 9.3 Mention to cluster matching

There is **no automatic mention-to-cluster matching**. A mention belongs to a cluster only when one of these happens:

1. It is created with an explicit `clusterId`.
2. It is assigned with `PUT /mentions/:mentionId/cluster/:clusterId`.
3. It is imported from a CoNLL chain.
4. A cluster merge repoints it from a source cluster to the target cluster.

There is no similarity score, embedding search, string-similarity lookup, or pronoun resolver. The UI is responsible for proposing/letting the user choose; the backend does exactly what it is told.

Rules that keep matching consistent:

- A mention can only be assigned to a cluster in the same workspace.
- Deleting a cluster **unassigns** its mentions instead of deleting them.
- Merging clusters moves all source mentions to the target, deletes the sources, and renumbers.
- Cluster numbers are unique per workspace and kept contiguous `1..N` after delete/merge.
- Cluster color is presentation-only and is assigned from a fixed palette.

### 9.4 Cluster numbering and renumbering

- New cluster: `MAX(cluster_number) + 1`.
- Delete cluster: mentions survive with `cluster_id = NULL`; the remaining clusters are renumbered.
- Merge: sources are removed; the target remains; all clusters are renumbered.
- Renumbering is transactional and uses a temporary negative range to avoid violating the unique `(workspace_id, cluster_number)` constraint.
- The CoNLL exporter uses cluster numbers (not ids) in coref markers, so contiguous numbering matters.

### 9.5 Recommendation rule matching

#### Rule 1: `UNFINISHED_MENTION` (HIGH)

Match: every `coref_mentions` row in the workspace whose `cluster_id IS NULL`.

Result: one card per mention, with the mention's document/span and a reason like `"the company" has no cluster assignment.`

Hash: `UNFINISHED_MENTION:<documentId>:<mentionId>`.

#### Rule 2: `DENSITY_GAP` (MEDIUM)

Match: every document in the workspace with **zero** mentions.

Result: one card per empty document, with reason `Document "name" has no annotations yet.`

Hash: `DENSITY_GAP:<documentId>:<documentId>`.

This is document-level, not token-level and not per annotator. Imported documents with zero mentions count.

#### Rule 3: `STRING_MATCH` (LOW)

This is the rule most people call "the matching".

Algorithm:

1. Collect every token `form` from every document in the workspace.
2. Count occurrences **exactly** (case-sensitive, no lowercasing, no lemma, no stemming).
3. Keep forms with count >= 3.
4. Remove Assamese stop words hardcoded in `stop-words.ts`:
   - demonstratives: `এই`, `সেই`, `ই`
   - locative particles: `ত`, `ৰ`, `ক`, `লৈ`
   - conjunctions: `আৰু`, `কিন্তু`, `অথবা`
   - subordinators/interrogatives: `যদি`, `যেতিয়া`, `যিহেতু`, `যি`
   - pronouns: `তেওঁ`, `মই`, `আমি`, `তুমি`
   - auxiliaries/verbs: `হয়`, `নাই`, `আছিল`
5. Sort by count descending, then form ascending.
6. Emit at most **50** cards.
7. Each card says: `"form" appears N times — consider annotating.`

Hash: `STRING_MATCH::<form>` (document id is empty).

Consequences:

- `Apple` and `apple` are different keys.
- Inflected forms are different keys unless they are identical strings.
- Punctuation can become a card if it repeats >= 3 times and is not a stop word.
- This rule does **not** create mentions, clusters, or annotations. It only suggests candidates.
- It is workspace-wide, so the same form across multiple documents is pooled.

#### Rule 4: `COREF_CHAIN_GAP` (MEDIUM)

Algorithm:

1. Build a map `documentId -> orderIndex` for the workspace.
2. For every cluster, collect the set of `orderIndex` values of documents that contain at least one of its mentions.
3. If the set is empty, skip.
4. Compute `missing = (max - min + 1) - set.size`.
5. If `missing > 0`, emit a card: `Cluster skips N document(s) in the chain — check for missed mentions.`

Hash: `COREF_CHAIN_GAP::<clusterId>`.

Example: a cluster has mentions in documents with order 1, 2, and 4. Documents 1 and 4 define the range; document 3 is missing, so `missing = 1` and the card is produced.

This is about **document order**, not token positions. It assumes documents are a continuous narrative chain, which is why it is a suggestion rather than an automatic fix.

#### Recommendation filtering

- Rules run every time recommendations are requested.
- Rules are concatenated in the order above; they are not globally re-sorted by priority in the API.
- Any recommendation whose hash has a `dismissed_recommendations` row for the current user is removed.
- `accepted: true` still hides the card; the flag is recorded for analytics/future use.
- The UI can hide/dismiss a card optimistically; the server upsert makes the dismissal durable.

### 9.6 CoNLL chain matching

The CoNLL parser matches parentheses across lines:

| Token annotation | Meaning |
|---|---|
| `(N)` | A complete single-token mention for chain `N`. |
| `(N` | Open a multi-token mention for chain `N`. |
| `N)` | Close the open mention for chain `N` at the current token. |
| `-` or `*` or empty | No coreference annotation. |
| `A\|B` | Apply both annotations to the same token. |

If a close appears without an open, that span is discarded. If a cluster id is not an integer, the import fails with 400.

The chain id becomes a cluster:

- If `N` is free in the workspace, the new cluster gets number `N`.
- Otherwise it gets the next free number above the current maximum.
- The original chain id is preserved in the label `CoNLL #N`.

### 9.7 POS majority matching

For each token:

1. Gather POS votes across annotators (one row per annotator due to the unique constraint).
2. Count votes per tag.
3. Pick the highest count.
4. On a tie, pick the alphabetically first tag.
5. If there are no votes, use the stored `tokens.pos` (which may be null).

This majority map is used in:

- CoNLL export (majority overrides stored POS),
- the public share export.

The editor content response does **not** use this majority map; it overlays POS annotation rows onto tokens for display.

### 9.8 WSD consensus matching

The consensus export uses a similar vote, with a different tie-break:

1. Group annotations by token.
2. Count votes per sense id.
3. Pick the highest count.
4. On a tie, pick the one with the latest annotation timestamp.
5. Output `token_id`, `word`, `sense_label`, `votes`.

The per-annotator export does not vote; it emits one row per annotation.

### 9.9 Label and tag matching

**NER labels**

- Input is trimmed and uppercased.
- Effective set = built-in OntoNotes tags + global custom tags + the document workspace's custom tags.
- An unknown label is rejected with a field error.
- Built-in conflicts and duplicates are rejected at tag creation.

**POS tags**

- Same normalization and effective-set logic.
- Built-in Universal-ish tags + global custom + workspace custom.
- `pos: null` means "remove my vote", not "vote for null".

### 9.10 Share-token matching

- The share token is an HS256 JWT signed with `JWT_SECRET`.
- Payload includes `workspace_id`.
- The public endpoint compares the payload's `workspace_id` with the path parameter.
- If they differ, the request is rejected even if the token signature is valid.
- The token expires after 24 hours.

This prevents a valid token for workspace A from downloading workspace B.

### 9.11 Notification matching

- Each notification has a `recipient_id`.
- The STOMP session is bound to a `userId` at CONNECT.
- `pushToUser` only delivers to sessions whose `userId` matches and whose subscription map contains the destination.
- Read/delete mutations are additionally scoped by recipient, so a user cannot operate on another user's row even with a guessed id.

### 9.12 Frontend annotation-type matching

The workspace stores one `annotationType`. The web route `/workspace/[id]/editor` resolves it server-side and dispatches to exactly one editor component:

```text
COREF -> CorefEditor
NER   -> NerEditor
POS   -> PosEditor
WSD   -> WsdEditor
```

The backend does not prevent calling NER endpoints on a COREF workspace; the type is a UI/workflow contract. This keeps the API simple but means clients are trusted to use the right family of endpoints.

---

## 10. Frontend integration

### 10.1 The big picture

```text
Browser
  |
  |  HTML / RSC payload / Server Action calls
  v
Next.js server (apps/web)
  |  middleware.ts             cookie guard + proactive refresh
  |  Server Components         RSC reads via serverFetch
  |  Server Actions ('use server')
  |  Route Handlers           /api/export proxy, /api/auth/end-session
  |  server/http.ts           reads HttpOnly cookies -> Bearer header
  v
Genesis API (apps/api)
  |  Hono -> routes -> services -> store/prisma.ts -> PostgreSQL
  v
PostgreSQL / local disk / Cloudinary
```

Browser-originated traffic that is not an ordinary RSC/Server Action response:

1. **SockJS/STOMP notifications** — browser opens `${NEXT_PUBLIC_API_URL}/ws`; the access token is fetched via a Server Action and passed as a STOMP header.
2. **Public share download** — the client renders `${NEXT_PUBLIC_API_URL}/api/public/export/conll/:workspaceId?token=...`; the token itself authorizes the download.
3. **Export download** — the browser posts to the Next route handler `/api/export/:type/:id`, which proxies to the API with the server-side cookie token and streams the blob back.

Everything else goes through a Server Component or Server Action.

### 10.2 The feature-layer pattern

Each web feature follows the same four files:

```text
features/<domain>/
├── <domain>.contracts.ts   TypeScript DTOs mirroring the backend
├── <domain>.gateway.ts     'server-only'; calls serverFetch(); unwraps ApiResponse
├── <domain>.actions.ts     'use server'; catches errors into ActionResult; revalidatePath()
└── components/...          'use client'; calls actions, owns local state
```

Example:

```text
WorkspaceShell (client)
  -> createWorkspaceAction(request)
    -> createWorkspace(request)            [gateway, server-only]
      -> serverFetch("/api/workspaces")   [reads access cookie, adds Bearer]
        -> POST /api/workspaces           [API]
  <- ActionResult<WorkspaceResponse>
  -> toast + router.refresh() / local state
```

`ActionResult<T>` is:

```ts
{ ok: true; data: T } | { ok: false; error: string }
```

The gateways are marked `server-only`, so a client component cannot accidentally import them and bypass the cookie-based auth.

### 10.3 UI action -> backend endpoint map

| UI action | Browser entry | Next layer | API endpoint |
|---|---|---|---|
| Log in | Login form -> `loginAction` | direct `fetch` (no session yet) | `POST /api/auth/login` |
| Sign up | Signup form -> `signupAction` | direct `fetch` | `POST /api/auth/signup` |
| Load session | App layout / AuthProvider | `getSessionAction` -> `serverFetch` | `GET /api/auth/me` |
| Log out | Header menu -> `logoutAction` | direct `fetch` + clear cookies | `POST /api/auth/logout` |
| Home workspace list | Home page RSC | `listWorkspaces` -> `serverFetch` | `GET /api/workspaces` |
| Create workspace | Home dialog -> `createWorkspaceAction` | gateway | `POST /api/workspaces` |
| Workspace page | RSC `Promise.all` | workspace + documents + members gateways | `GET /api/workspaces/:id`, `/documents`, `/members` |
| Update workspace | Settings panel -> action | gateway | `PUT /api/workspaces/:id` |
| Change status | UI action | gateway | `PUT /api/workspaces/:id/status?status=` |
| Upload document | Upload button -> `uploadDocumentAction` | `FormData` gateway | `POST /api/workspaces/:id/documents` |
| Delete document | Doc menu -> `deleteDocumentAction` | gateway | `DELETE /api/documents/:id` |
| Mark document complete | Editor action | `updateDocumentStatusAction` | `PUT /api/documents/:id/status?status=COMPLETE` |
| Open editor | Editor page RSC | dispatches by annotation type | `GET /api/workspaces/:id` (type) |
| Load editor docs | Client effect -> `getEditorDocumentsAction` | gateway | `GET /api/editor/workspaces/:id/documents` |
| Load page 0 | Client effect -> `getDocumentContentAction` | gateway | `GET /api/editor/workspaces/:id/documents/:docId/content?page=0` |
| Infinite scroll | IntersectionObserver -> same action | gateway | same endpoint, `page+1` |
| Save resume position | `saveEditorSessionAction` | gateway | `POST /api/editor/session` |
| Coref create mention | Selection tool -> `createMentionAction` | gateway | `POST /api/workspaces/:id/mentions` |
| Coref assign mention | UI -> `assignToClusterAction` | gateway | `PUT /api/mentions/:id/cluster/:clusterId` |
| Coref merge | UI -> `mergeClustersAction` | gateway | `POST /api/workspaces/:id/clusters/merge` |
| NER create span | UI -> `createNerAnnotationAction` | gateway | `POST /api/ner-annotations` |
| POS tag token | UI -> `updateTokenPosAction` | gateway | `PUT /api/tokens/:id/pos` |
| WSD annotate token | UI -> `upsertAnnotationAction` | gateway | `POST /api/workspaces/:id/wsd/annotations` |
| List suggestions | Recommendations page RSC | gateway | `GET /api/workspaces/:id/recommendations` |
| Dismiss suggestion | Card button -> `dismissRecommendationAction` | gateway | `POST .../recommendations/dismissals` |
| Create share link | Button -> `issueShareTokenAction` | gateway | `POST .../export/share` |
| Download export | Export dialog | `fetch('/api/export/...')` -> route handler | `POST /api/export/...` |
| Notification list | Notification provider | `listNotificationsAction` | `GET /api/notifications` |
| Mark read | Dropdown -> action | gateway | `PUT /api/notifications/:id/read` |
| Realtime notification | SockJS client | direct browser connection | `GET/POST /ws/...` + STOMP |

### 10.4 Auth integration, step by step

1. The browser posts to a Next Server Action. No token is sent from the browser.
2. `loginAction` calls the API directly and receives `{ accessToken, refreshToken, expiresIn }`.
3. It writes both tokens into HttpOnly cookies.
4. On protected routes, middleware checks the access cookie.
5. If the access cookie is gone but a refresh cookie remains, middleware calls the API refresh endpoint and rotates both cookies.
6. RSC pages call gateways; gateways use `serverFetch`, which reads the access cookie and adds `Authorization: Bearer ...`.
7. If the API returns 401, `serverFetch` throws `SessionExpiredError`.
8. The page redirects to `/api/auth/end-session`, which clears cookies and redirects to `/login`.
9. If the API is unreachable, `serverFetch` throws `NetworkError` instead, so a temporary outage does not log the user out.

The middleware matcher protects `/home`, `/workspace`, and `/api/export`. It also redirects logged-in users away from `/login` and `/signup`.

### 10.5 Editor integration, step by step

1. `/workspace/:id/editor` runs server-side and fetches the workspace to learn its annotation type.
2. It renders one of `CorefEditor`, `NerEditor`, `PosEditor`, `WsdEditor`.
3. The client editor calls `getEditorDocumentsAction(workspaceId)` to list documents and token/sentence counts.
4. It calls `getEditorSessionAction(workspaceId)` to restore `lastDocumentIndex` / `scrollPosition`.
5. It calls `getDocumentContentAction(workspaceId, documentId, 0, PAGE_SIZE)` for page 0.
6. The content response provides sentences, tokens, totals, and `globalTokenOffset`.
7. Scrolling to the bottom triggers the next page: NER/POS/WSD use `usePaginatedDocument`; CorefEditor has the same sentinel behaviour built in.
8. Annotation operations go through domain actions, then the editor refetches mentions/clusters or updates local state.
9. Session saves are debounced and best-effort; failures do not block annotation.

### 10.6 Realtime notification flow

1. `apps/web/src/app/(app)/layout.tsx` resolves the user server-side and seeds `AuthProvider`.
2. `NotificationProvider` loads the initial list via `listNotificationsAction`.
3. It asks for the access token via `getAccessTokenAction` (the only way JS can see the HttpOnly cookie value).
4. It creates a STOMP client with `SockJS(..., { transports: ['xhr-polling'] })`.
5. STOMP `CONNECT` includes `Authorization: Bearer <token>`.
6. On connect it subscribes to `/user/queue/notifications`.
7. A server-side `saveNotification` persists the row and pushes the frame immediately.
8. The client prepends the notification and increments unread count.
9. If the socket drops, `reconnectDelay: 5000` reconnects. If the API restarts, in-memory sessions are lost but the persisted list is still available.

### 10.7 Export integration

The browser cannot stream a binary from a Server Action, so export uses a Route Handler:

```text
WorkspaceShell.fetch('/api/export/workspaces/:id', { method: POST, body: options })
  -> apps/web/src/app/api/export/[type]/[id]/route.ts
    -> reads HttpOnly access cookie
    -> POST ${INTERNAL_API_URL}/api/export/workspaces/:id
      -> API returns .conll or .zip
  <- streams body + Content-Disposition back to the browser
  -> browser creates a Blob URL and triggers download
```

The route handler only allows `workspaces` and `documents`.

### 10.8 Share-link integration

```text
Recommendations page
  -> issueShareTokenAction(workspaceId)
    -> POST /api/workspaces/:id/export/share
  <- { token, expiresInSeconds }
  -> client builds `${NEXT_PUBLIC_API_URL}/api/public/export/conll/:id?token=...`
  -> user copies the URL
  -> recipient opens it directly; no login required
```

### 10.9 DTO ownership

`packages/contracts` exists, but it currently contains only:

- `UserRoleSchema` (`ADMIN`/`CURATOR`/`ANNOTATOR`),
- `AnnotationTaskTypeSchema` (`COREF`/`NER`/`POS`/`WSD`),
- a generic `ApiResponseSchema`.

The web app keeps its own feature contracts (`*.contracts.ts`) that mirror the backend DTO interfaces. When changing a response shape, update both the API schema/DTO and the corresponding web contract.

### 10.10 Environment split

- `NEXT_PUBLIC_API_URL` is inlined into the browser bundle. It is used by the STOMP client and share URLs.
- `INTERNAL_API_URL` is server-only and is used by Server Actions, RSC `serverFetch`, middleware refresh, the export proxy, and end-session. In Docker this can point at a compose service name; locally it defaults to the public URL.
- The API's CORS allow-list must include the browser origin because STOMP is browser-originated (and so any future direct browser API call will work).

### 10.11 End-to-end trace: creating a workspace

This is the shortest path through every layer, useful for setting breakpoints:

```text
1. Browser: CreateWorkspaceDialog submits via HomeClient
      apps/web/src/features/home/components/CreateWorkspaceDialog.tsx
      apps/web/src/features/home/components/HomeClient.tsx
      handleCreateWorkspace(request)

2. Server Action
      apps/web/src/features/workspace/workspace.actions.ts
      createWorkspaceAction(request)

3. Server-only gateway
      apps/web/src/features/workspace/workspace.gateway.ts
      createWorkspace(request)
        -> serverFetch("/api/workspaces", { method: "POST", body: ... })

4. Token injection
      apps/web/src/server/http.ts
      reads genesis_access_token cookie
      adds Authorization: Bearer <accessToken>
      calls ${INTERNAL_API_URL}/api/workspaces

5. API routing
      apps/api/src/app.ts                 mounts /api/workspaces
      apps/api/src/routes/workspace.routes.ts
        -> parseOrThrow(createWorkspaceSchema, body)

6. Business logic
      apps/api/src/services/workspace.service.ts
        -> require auth (already done by middleware)
        -> reject duplicate name for owner
        -> saveWorkspace(status = DRAFT)
        -> saveMember(creator, ADMIN)
        -> notifyUser("Workspace Created")

7. Persistence + push
      apps/api/src/store/prisma.ts
        -> INSERT workspaces / workspace_members / notifications
        -> pushToUser(...) for a live STOMP session

8. Response
      { success: true, data: WorkspaceResponse, message, timestamp }
      gateway unwraps data
      action calls revalidatePath("/home")
      returns { ok: true, data: workspace }

9. Browser
      dialog closes
      HomeClient prepends the new workspace to local state
      revalidatePath("/home") marks the RSC data stale for the next navigation/render
```

If something goes wrong at step 3/4, the UI usually shows a session error or a network error; if it goes wrong at step 5/6, it shows the API's `message`/`fieldErrors`; if it goes wrong at step 7, the API returns a generic 500 and logs the stack.

---

## 11. Environment variables

### API

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NODE_ENV` | No | `development` | Production enables stricter config checks. |
| `PORT` | No | `8080` | API listener port when run directly. |
| `DATABASE_URL` / `DB_URL` | **Yes** | none | PostgreSQL connection string. |
| `JWT_SECRET` | Yes in production | dev fallback | HS256 signing key for access, refresh-share, and share tokens. Must be >= 32 chars. |
| `JWT_ACCESS_TOKEN_EXPIRY` | No | `15m` | Access token TTL. |
| `JWT_REFRESH_TOKEN_EXPIRY` | No | `7d` | Refresh token TTL. |
| `CORS_ALLOWED_ORIGINS` | Yes in production | `http://localhost:3000,http://127.0.0.1:3000` in dev | Comma-separated browser origins. |
| `STORAGE_PROVIDER` | No | `cloudinary` (code default); `local` via dev launcher | `local` or `cloudinary`. |
| `STORAGE_RETAIN_SOURCE` | No | `true` | Set `false` to delete the raw source after processing. |
| `STORAGE_LOCAL_BASE_PATH` | No | `./data/uploads` | Local upload directory, resolved from the API working directory. |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary only | none | Cloudinary cloud. |
| `CLOUDINARY_API_KEY` | Cloudinary only | none | Cloudinary key. |
| `CLOUDINARY_API_SECRET` | Cloudinary only | none | Cloudinary secret. |
| `API_REQUEST_LOGS` | No | on in dev | Set `true`/`false` to force request logging. |
| `API_PORT` | No | `8099` | Used by `scripts/dev.mjs`, not by the API itself. |

### Web

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Yes in production | Browser-facing API base URL (STOMP + share URLs). Inlined at build time. |
| `INTERNAL_API_URL` | No | Server-side API base URL for RSC, Server Actions, middleware, and route handlers. |
| `WEB_PORT` | No | Next dev port used by the launcher, default `3000`. |

---

## 12. Run, test, validate

### Local stack

Follow `SETUP.md` at the repository root. The short version:

```bash
# 1. create the database and apply Flyway V1-V8 with psql
# 2. install and generate Prisma
pnpm install
pnpm --filter @genesis/api exec prisma generate

# 3. start API + web with prefixed logs
pnpm dev
```

URLs:

- API: `http://localhost:8099`
- Web: `http://localhost:3000`
- Health: `http://localhost:8099/api/health`

### API only

```bash
pnpm dev:api
```

### Checks

```bash
pnpm --filter @genesis/api typecheck
pnpm --filter @genesis/api test
pnpm --filter @genesis/web exec tsc --noEmit
```

The API test suite:

- runs the real Hono app via `app.request()`,
- requires PostgreSQL,
- creates unique users/workspaces,
- cleans up its own rows and stored files,
- does not bind a port,
- covers health, auth, workspace create/get/list, upload/tokenization, NER span/label validation, POS tag validation, notification ownership, and workspace cascade delete.

### Production build

```bash
pnpm --filter @genesis/api build
pnpm --filter @genesis/api start
```

`NODE_ENV=production` requires `JWT_SECRET`, `CORS_ALLOWED_ORIGINS`, `DATABASE_URL`, and a production `NEXT_PUBLIC_API_URL` at web build time.

---

## 13. Known limitations and deferred hardening

These are real behaviours, not TODOs invented for the README. Most are acceptable for the current single-team deployment.

1. **Tag mutation authorization is incomplete.** NER/POS custom tag creation validates membership for `WORKSPACE` scope, but global tag creation and all tag deletion have no admin/creator check. Any authenticated user can delete a tag definition.
2. **Tokenization is in-process and not durable.** A crash while a document is `PENDING` or `PROCESSING` leaves it stranded until the re-tokenize hook is called. There is no queue, retry, or worker.
3. **The re-tokenize endpoint is unauthenticated.** `POST /api/editor/documents/:documentId/tokenize` is a legacy admin hook and can be called by anyone who can reach the API.
4. **Re-tokenization can orphan annotations.** It replaces tokens (cascading POS/WSD votes) but does not clear NER annotations or coref mentions, which are index-based and can become stale.
5. **No native WebSocket transport.** SockJS xhr-polling is the only supported transport. `/ws/info` advertises `websocket: false`.
6. **STOMP sessions are in-memory.** A server restart drops live sessions; clients reconnect after 5 seconds. Persisted notifications still load via the REST list.
7. **Cloudinary is optional.** Missing credentials cause a warning and a local-disk fallback. Local disk is the documented development path.
8. **Coref mention spans are not bounds-checked.** Creation verifies `end >= start` and workspace ownership, but not that the end token exists in the document. NER does bounds-check.
9. **The annotation type is not enforced at the endpoint level.** A COREF workspace can technically receive NER/POS/WSD calls if the caller knows the ids; only membership is checked. The UI dispatches the correct editor.
10. **Recommendation rules are exact and simple.** No stemming, no lowercasing, no lemmatization, no embeddings, no automatic linking. `STRING_MATCH` is an exact surface-form counter.
11. **`accepted` dismissals still hide the card.** The flag is stored but the list filters all dismissed hashes.
12. **Cursor pagination loads the full list server-side.** Mentions and clusters are fetched from the database and sliced in memory; the cursor reduces response size, not database work.
13. **Batch POS is not transactional.** A failing item leaves earlier items committed.
14. **Workspace deletion is N+1 and notification-heavy.** Every document and member triggers its own queries/notifications.
15. **No rate limiting in the TypeScript API.** The legacy Java rate-limit filter was not ported.
16. **No email verification, password reset, OAuth, or invitation emails.** `nodemailer` is present in dependencies but unused; members must already have accounts.
17. **Audit columns are populated heuristically.** Most system writes use `"system"`; POS/WSD use annotator ids in some paths. `version` is not used for optimistic locking.
18. **Not every mutation is logged.** NER has no log entries; coref unassign/rename/delete are not logged.
19. **Refresh cookie and token lifetimes differ.** The cookie keeps the refresh token for 30 days, but the server token expires after 7 days by default; the server is authoritative.
20. **Workspace `status` is manual.** Nothing automatically moves a workspace from `DRAFT` to `ACTIVE` or `ARCHIVED`.
21. **WSD annotation does not verify the token's workspace.** It verifies that the sense is in the requested workspace and that the token/document exist, but it does not check that the token's document belongs to that workspace. A caller who knows a foreign token id could create a cross-workspace annotation.

---

### 13.1 Explicit non-goals

- No mock/offline mode. The frontend always calls the real API.
- No in-memory persistence fallback.
- No Prisma migrations. Flyway owns the schema.
- No separate worker process. Tokenization is in-process.
- No automatic coreference resolution or entity linking.

---

## 14. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `503` on `/api/health` | PostgreSQL unreachable or wrong `DATABASE_URL`. |
| API exits at startup: `DATABASE_URL (or DB_URL) must be set` | Env not loaded. Use `pnpm dev` or set the variable. |
| API exits: `JWT_SECRET must be at least 32 characters` | Short dev/prod secret. |
| `401` loop between `/home` and `/login` | Stale cookies or refresh failure. Clear `genesis_access_token` / `genesis_refresh_token`, or fix the API URL. |
| Browser CORS error on STOMP (or any direct API call) | Add the web origin to `CORS_ALLOWED_ORIGINS`. |
| Notification socket keeps reconnecting | Check `NEXT_PUBLIC_API_URL`, the access token action, and that the API is reachable; only xhr-polling is supported. |
| Upload returns `413` | File exceeds 50 MB. |
| Upload returns `400 Missing file field` | Multipart field must be named `file`. |
| Document stuck at `PENDING`/`PROCESSING` | The process crashed or restarted; call the re-tokenize hook or re-upload. |
| Editor shows no tokens | `processingStatus` is not `COMPLETED`; check `processingError`, or re-tokenize. |
| Prisma error about missing client | Run `pnpm --filter @genesis/api exec prisma generate`. |
| `prisma migrate` suggests changes | Do not use it. The schema is Flyway-owned. |
| Add member -> `User not found` | The target must already have an account with that email. |
| Delete workspace -> many document-deleted notifications | Expected: workspace deletion delegates to per-document deletion first. |
| PDF/HTML error page from API | Should not happen; all errors are enveloped. Check the process logs for an unhandled error. |

---

## 15. Glossary

| Term | Meaning |
|---|---|
| **Workspace** | One annotation project with one task type, documents, and members. |
| **Annotation type** | `COREF`, `NER`, `POS`, or `WSD`. |
| **Document** | An uploaded text or CoNLL file. |
| **Sentence** | A row in `sentences`, identified by `sentenceIndex`. |
| **Token** | A row in `tokens`, identified by `(sentenceIndex, tokenIndex)` and a document-level `globalIndex`. |
| **Span** | An inclusive token range `[startTokenIndex, endTokenIndex]`. |
| **Mention** | A coreference span, optionally assigned to a cluster. |
| **Cluster** | A workspace-level group of mentions referring to the same entity. Numbered `1..N` per workspace. |
| **Annotation** | A generic term for a mention, NER span, POS vote, or WSD vote. |
| **Vote** | One annotator's POS tag or WSD sense for a token. |
| **Recommendation** | A computed suggestion card; not a persisted entity. |
| **Dismissal** | A per-user record that hides a recommendation hash. |
| **Stored file** | The raw upload in local disk or Cloudinary. |
| **Processing status** | Tokenization state: `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`. |
| **Document status** | Workflow state: `UPLOADED`, `IMPORTED`, `ANNOTATING`, `COMPLETE`. |
| **Workspace token range** | The document's continuous token offset across the workspace. |
| **Effective tags** | Built-in tags + global custom tags + workspace custom tags. |
| **Majority POS** | Per-token winner across annotator votes, tie-broken alphabetically. |
| **Consensus sense** | Per-token winning WSD sense, tie-broken by latest annotation. |
| **STOMP** | The messaging protocol used over SockJS for live notifications. |

---

## 16. Where to change what

| I want to... | Start here |
|---|---|
| Add or change an endpoint | `src/routes/<domain>.routes.ts`, then the service |
| Change business rules | `src/services/<domain>.service.ts` |
| Change request validation or response fields | `src/schemas/<domain>.schemas.ts` (and the web `*.contracts.ts`) |
| Change a database query or cascade | `src/store/prisma.ts` |
| Change the schema | Legacy Flyway SQL; then regenerate Prisma and update `schema.prisma` |
| Change auth/token behaviour | `src/services/auth.service.ts`, `src/services/refresh-token.service.ts`, `src/lib/jwt.ts` |
| Change tokenization | `src/services/tokenizer/` |
| Change CoNLL parsing/export | `src/services/conll-parser.ts`, `conll-exporter.ts`, `import.service.ts` |
| Change recommendation rules | `src/services/recommendation.service.ts`, `recommendation-hash.ts`, `stop-words.ts` |
| Change notification events | `src/services/workspace.service.ts`, `document.service.ts`, `notification.service.ts` |
| Change notification transport | `src/services/stomp-broker.ts`, `src/routes/ws.routes.ts` |
| Change storage | `src/services/storage/` |
| Change the frontend integration | `apps/web/src/server/http.ts`, `apps/web/src/middleware.ts`, `apps/web/src/features/*/*.gateway.ts` |
| Change the frontend UI | `apps/web/src/features/*/components/` |

---

**See also**

- [`../../SETUP.md`](../../SETUP.md) — full local setup, database bootstrap, ports, troubleshooting.
- [`../../BACKEND_MIGRATION.md`](../../BACKEND_MIGRATION.md) — parity notes, validation evidence, deferred hardening.
- [`../../legacy/genesis-java/`](../../legacy/genesis-java/) — read-only Java reference implementation.
