# CLAUDE.md

Guidance for AI coding agents working in this repository.

## Repository

- **Local path:** `D:\GU\Gensi\genesis`
- **GitHub:** `https://github.com/BhairabMahanta/genesis`
- **Active backend:** `apps/api` — Hono + Prisma + PostgreSQL
- **Frontend:** `apps/web` — Next.js 15 App Router, React 19, Tailwind CSS v4, shadcn/ui
- **Shared contracts:** `packages/contracts`
- **Legacy reference:** `legacy/genesis-java` — Java 21 / Spring Boot; **read-only, never modify**

The TypeScript API is the production backend. PostgreSQL is the only persistence backend.
The frontend has **no mock/offline mode**; it always authenticates and talks to the real API.

## Commands

Run from the repository root:

```bash
pnpm dev          # API + web, prefixed logs ([BACKEND] / [FRONTEND])
pnpm dev:api      # API only
pnpm dev:web      # web only
pnpm build        # build all workspaces
pnpm lint         # workspace lint scripts that exist
```

Targeted checks:

```bash
# API integration smoke suite (real PostgreSQL; cleans up its own rows)
pnpm --filter @genesis/api test

# Type checks
pnpm --filter @genesis/api typecheck
pnpm --filter @genesis/web exec tsc --noEmit

# Web lint
pnpm --filter @genesis/web lint

# Prisma client after install / schema sync
pnpm --filter @genesis/api exec prisma generate
```

## Local runtime

`pnpm dev` runs `scripts/dev.mjs`, which:

- starts the API on **`http://localhost:8099`** and the web app on **`http://localhost:3000`**;
- sets `NEXT_PUBLIC_API_URL`, `INTERNAL_API_URL`, and `CORS_ALLOWED_ORIGINS` for the children;
- reads optional `.env.local` / `.env` from the repository root (shell env wins);
- refuses to start when a configured port is occupied instead of letting Next move to `3001`;
- prefixes child output with `[BACKEND]` / `[FRONTEND]`;
- stops both processes together.

Port `8099` is the local default because `0.0.0.0:8080` is commonly occupied by Apache (`PEMHTTPD-x64`) on this machine. The API's raw code default remains `8080` when run outside the launcher.

Useful endpoints and logs:

- Health: `GET http://localhost:8099/api/health`
- Terminal `[BACKEND]`: API method, path, status, duration (`API_REQUEST_LOGS`)
- Terminal `[FRONTEND]`: Next page requests, Server Actions, server-side fetches
- Browser console `[FRONTEND]`: client route changes, browser `fetch` calls, uncaught errors

Server-side and API logs never appear in the browser console by design. See `SETUP.md` for configuration and troubleshooting.

## Architecture

```text
apps/
├── web/                    Next.js frontend
│   └── src/
│       ├── app/            App Router routes + Next route handlers
│       ├── features/       Feature slices (auth, document, workspace, editor, notifications, ...)
│       ├── server/         serverFetch, cookies, errors, server-only contracts
│       ├── config/         validated API URL/environment access
│       └── components/     shared UI and root providers
├── api/                    TypeScript API
│   └── src/
│       ├── app.ts          Hono app (testable, no listener)
│       ├── index.ts        HTTP listener / startup
│       ├── routes/         HTTP layer, one file per domain
│       ├── services/       business logic
│       ├── schemas/        Zod validation + DTOs
│       ├── middleware/     JWT auth, CORS, error envelope, request logging
│       ├── store/          Prisma persistence and queries
│       └── lib/            JWT/password helpers
├── contracts/              Shared Zod schemas and response contracts
scripts/dev.mjs             Local two-service launcher
legacy/genesis-java/        Read-only Java/Spring reference
```

API conventions:

- Responses use the legacy `ApiResponse<T>` envelope (`success`, `data`, `message`, optional `fieldErrors`).
- Request validation belongs in `src/schemas/`; business logic in `src/services/`; Prisma access in `src/store/`.
- The Hono app is shared by the server and tests; only `src/index.ts` opens a listener.
- The schema is owned by the legacy Flyway migrations `V1`–`V8`. Prisma is a typed query client only — do **not** use `prisma migrate` or `prisma db push`.
- Notifications use persisted rows plus SockJS xhr-polling and a minimal STOMP broker. Native WebSocket is intentionally not implemented.

Web conventions:

- Feature code stays inside `src/features/<feature>/` (contracts, gateway, actions, components).
- Gateways imported by server code use `server-only`; browser code should go through Server Actions or route handlers rather than calling the API directly.
- `src/server/http.ts` is the server-side API client; it reads HttpOnly cookies and handles session expiry.
- `src/middleware.ts` performs proactive refresh and route protection.
- `NEXT_PUBLIC_*` values are inlined at build time; restart the dev server after changing them.

## Do not reintroduce mock mode

Mock mode was removed as part of the Java → TypeScript/real-API migration:

- `apps/web/src/server/mock-data.ts` is deleted.
- `IS_MOCK_MODE` / `NEXT_PUBLIC_MOCK_MODE` and all mock branches/imports are gone.
- The frontend always reads and writes the real API.

A remote feature commit that extended mock mode (`0a19be9`) was intentionally dropped during the 2026-10-20 merge. A branch that reintroduces `IS_MOCK_MODE`, `mock-data.ts`, or mock gateway branches is incompatible with the current architecture.

## Documentation map

- `README.md` — monorepo overview, quick start, configuration
- `SETUP.md` — full local setup, schema application, ports, logs, troubleshooting
- `BACKEND_MIGRATION.md` — migration outcomes, endpoint coverage, validation evidence, deferred hardening

## Deferred hardening

These do not block current functional flows:

1. NER/POS tag mutation authorization (global tag create/delete and tag deletion).
2. Optional native WebSocket transport.
3. Optional durable/retry processing for tokenization.
4. Production Cloudinary credential validation.

See `BACKEND_MIGRATION.md` §8 for details.
