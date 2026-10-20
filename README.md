# Genesis (Monorepo)

A full-stack, multi-task NLP annotation platform for coreference resolution, named-entity recognition (NER), part-of-speech tagging (POS), and word-sense disambiguation (WSD).

## Monorepo architecture

```text
genesis/
├── apps/
│   ├── web/                    # Next.js 15 (React 19, Tailwind CSS v4, shadcn/ui)
│   └── api/                    # TypeScript backend (Hono + Prisma + PostgreSQL)
├── packages/
│   └── contracts/              # Shared Zod schemas, types, and DTO contracts
├── legacy/
│   └── genesis-java/           # Original Java 21 / Spring Boot monolith (reference only)
├── pnpm-workspace.yaml
└── package.json
```

| Workspace | Path | Stack / role |
|---|---|---|
| **`@genesis/web`** | `apps/web` | Next.js App Router, React 19, Tailwind v4, STOMP notifications |
| **`@genesis/api`** | `apps/api` | Hono, Prisma, PostgreSQL, JWT, SockJS/STOMP |
| **`@genesis/contracts`** | `packages/contracts` | Shared types and Zod schemas |
| **Legacy backend** | `legacy/genesis-java` | Java 21 / Spring Boot 3.3 / Flyway (reference only) |

The TypeScript API is the active backend. The Java project is kept as a read-only behavioural reference. PostgreSQL is the only persistence backend; there is no in-memory mode.

## Quick start

For the full walkthrough, see [**`SETUP.md`**](SETUP.md).

### Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL 15+ (tested on PostgreSQL 18; the schema is applied from the legacy Flyway SQL)

### 1. Create the database and apply the schema

```bash
createdb -U postgres genesis
```

Apply `legacy/genesis-java/genesis-api/src/main/resources/db/migration/V1__baseline.sql` through `V8__wsd_annotation_document_id.sql` in filename order with `psql` (see [SETUP.md](SETUP.md) for the PowerShell loop).

### 2. Install dependencies and generate Prisma

```bash
pnpm install
pnpm --filter @genesis/api exec prisma generate
```

### 3. Start the stack

From the repository root:

```powershell
pnpm dev
```

This starts both services with prefixed terminal logs:

| Service | URL | Log prefix |
|---|---|---|
| API | `http://localhost:8099` | `[BACKEND]` |
| Web | `http://localhost:3000` | `[FRONTEND]` |

Open `http://localhost:3000`, then sign up and create a workspace. Health check: `http://localhost:8099/api/health` returns `UP` only when the database is reachable.

The launcher reads optional `.env.local` / `.env` files from the repository root. Copy `.env.example` to `.env` to override the defaults:

```powershell
Copy-Item .env.example .env
```

Port `8099` is the local default because `8080` is commonly occupied. The launcher refuses to start if a configured port is taken instead of silently moving the frontend to `3001`. Use `pnpm dev:api` or `pnpm dev:web` to run one service. See [SETUP.md](SETUP.md#step-4--start-the-full-stack) for details.

## Tests and checks

```bash
# API integration smoke suite (requires PostgreSQL; cleans up its own rows)
pnpm --filter @genesis/api test

# Type checks
pnpm --filter @genesis/api typecheck
pnpm --filter @genesis/web exec tsc --noEmit

# Production build (set NEXT_PUBLIC_API_URL first)
pnpm build
```

On Windows accounts without symbolic-link privileges, Next's standalone bundle step can fail with `EPERM` under `.next/standalone`. Build without the Docker bundle instead:

```powershell
$env:NEXT_STANDALONE = "false"
pnpm build
```

## Configuration

| Variable | Used by | Purpose |
|---|---|---|
| `API_PORT` | Dev launcher | API port set for `pnpm dev`, default `8099` |
| `WEB_PORT` | Dev launcher | Web port set for `pnpm dev`, default `3000` |
| `API_REQUEST_LOGS` | Dev launcher / API | Set `false` to silence API request logs |
| `DATABASE_URL` | API | PostgreSQL connection string (`DB_URL` is accepted as an alias) |
| `PORT` | API | Listener port when running the API directly, default `8080` |
| `JWT_SECRET` | API | Access-token signing key; required in production, dev fallback otherwise |
| `JWT_ACCESS_TOKEN_EXPIRY` | API | Access-token TTL, default `15m` |
| `JWT_REFRESH_TOKEN_EXPIRY` | API | Refresh-token TTL, default `7d` |
| `CORS_ALLOWED_ORIGINS` | API | Comma-separated browser origins |
| `STORAGE_PROVIDER` | API | `local` or `cloudinary` |
| `STORAGE_LOCAL_BASE_PATH` | API | Local upload directory (default `./data/uploads`) |
| `NEXT_PUBLIC_API_URL` | Web | Browser-facing API base URL (inlined at build time) |
| `INTERNAL_API_URL` | Web | Server-side API base URL (RSC, Server Actions, route handlers) |

## Migration status

P0 persistence, P1 integrity/notifications, and P2 validation are complete; the frontend has been validated against the real TypeScript API. Deferred hardening items and the full validation log are tracked in [**`BACKEND_MIGRATION.md`**](BACKEND_MIGRATION.md).
