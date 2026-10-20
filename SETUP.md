# Genesis — Local Setup Guide

This guide runs the real stack: PostgreSQL + the TypeScript API (`apps/api`) + the Next.js frontend (`apps/web`). There is no mock data or offline frontend mode — the UI always talks to the API.

Both PowerShell and POSIX-style commands are shown where they differ. Examples use the default PostgreSQL superuser (`postgres` / `postgres`); change the credentials if your installation differs.

---

## Step 0 — Prerequisites

Check the toolchain:

```powershell
node -v        # 20 or newer
pnpm -v        # 9 or newer
psql --version # PostgreSQL 15 or newer
```

If pnpm is missing:

```powershell
corepack enable
# or: npm install -g pnpm
```

Start PostgreSQL and confirm it accepts connections:

```powershell
Get-Service postgresql*
psql -U postgres -h localhost -d postgres -c "select version();"
```

The schema comes from the legacy Flyway migrations and is applied with `psql`; Flyway itself is not required for the TypeScript API.

---

## Step 1 — Create the database

From the repository root:

```powershell
$env:PGPASSWORD = "postgres"
$psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe" # adjust version/path

& $psql -U postgres -h localhost -d postgres -c "CREATE DATABASE genesis;"
```

If the database already exists, skip the `CREATE DATABASE` command.

---

## Step 2 — Apply the schema (V1–V8)

The TypeScript API expects the exact schema from the legacy Flyway migrations. Apply every file in filename order:

```powershell
$migrations = "legacy\genesis-java\genesis-api\src\main\resources\db\migration"

Get-ChildItem "$migrations\V*.sql" |
  Sort-Object Name |
  ForEach-Object {
    Write-Host "Applying $($_.Name)"
    & $psql -U postgres -h localhost -d genesis -v ON_ERROR_STOP=1 -f $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "Migration failed: $($_.Name)" }
  }
```

Verify the tables exist (the schema has 20 application tables):

```powershell
& $psql -U postgres -h localhost -d genesis -c "\dt"
```

> Apply the migrations once to an empty database. Re-running `V1__baseline.sql` against a populated schema will fail.

---

## Step 3 — Install dependencies and generate Prisma

From the repository root:

```powershell
pnpm install
pnpm --filter @genesis/api exec prisma generate
```

Prisma is used as a typed query client only. The Flyway SQL remains the schema authority; do not use `prisma migrate` or `prisma db push` to change the schema.

---

## Step 4 — Start the full stack

From the repository root:

```powershell
pnpm dev
```

This starts both services with prefixed logs and fixed local ports:

| Service | Default URL | Log prefix |
|---|---|---|
| API | `http://localhost:8099` | `[BACKEND]` |
| Web | `http://localhost:3000` | `[FRONTEND]` |

Open **http://localhost:3000**. Check the API at `http://localhost:8099/api/health`; it returns `UP` only when PostgreSQL is reachable.

The launcher reads optional `.env.local` and `.env` files from the repository root. Copy `.env.example` to `.env` to override defaults:

```powershell
Copy-Item .env.example .env
```

Defaults applied when the variables are unset:

- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/genesis`
- `API_PORT=8099` (avoids the common port-8080 conflict)
- `WEB_PORT=3000`
- `NEXT_PUBLIC_API_URL` / `INTERNAL_API_URL` follow `API_PORT`
- `STORAGE_PROVIDER=local`
- `JWT_SECRET` uses a development-only fallback that is stable across restarts

Shell environment variables take precedence over `.env` values. `NEXT_PUBLIC_*` values are inlined when Next compiles, so restart `pnpm dev` after changing them.

### Run only one service

```powershell
pnpm dev:api   # API only, [BACKEND] logs
pnpm dev:web   # web only, [FRONTEND] logs, expects the API at localhost:8099
```

### Port conflicts

The launcher checks the configured ports before starting and exits with a clear message instead of letting Next silently move to 3001. Stop the existing process, or pick another port in `.env`:

```text
API_PORT=8100
WEB_PORT=3001
```

If you run a service outside the launcher, export the matching `NEXT_PUBLIC_API_URL` and `INTERNAL_API_URL` values yourself.

### Where the logs go

- `[BACKEND]` lines are API request logs (`method path status duration`) from the terminal running `pnpm dev`.
- `[FRONTEND]` lines are Next.js server logs (page requests, Server Actions, outbound fetches to the API).
- Browser DevTools console shows client-side `[FRONTEND]` route, fetch, and uncaught-error breadcrumbs. Server-side logs never appear in the browser console by design.

---

## Step 5 — First use

1. Go to `http://localhost:3000/signup` and create an account.
2. Sign in. The home dashboard loads workspaces from PostgreSQL.
3. Create a workspace (NER, COREF, POS, or WSD).
4. Open the workspace, upload a plain-text document, and wait for processing to finish.
5. Open the editor to inspect sentences and tokens.
6. The notification bell shows workspace/document events and receives new events live over STOMP.

---

## Tests and type checks

The API suite is an integration smoke test: it uses the real app and PostgreSQL, creates uniquely named users/workspaces, and removes them at the end.

```powershell
pnpm --filter @genesis/api test
```

Override the test database with `DATABASE_URL` if needed. The default is `postgresql://postgres:postgres@localhost:5432/genesis`.

Type checks:

```powershell
pnpm --filter @genesis/api typecheck
pnpm --filter @genesis/web exec tsc --noEmit
```

Production build:

```powershell
$env:NEXT_PUBLIC_API_URL = "http://localhost:8099"
$env:INTERNAL_API_URL = "http://localhost:8099"
pnpm build
```

On Windows accounts without symbolic-link privileges, Next's standalone bundle step can fail with `EPERM` while copying `react`/`next` into `.next/standalone`. Skip the Docker bundle for a local build:

```powershell
$env:NEXT_STANDALONE = "false"
pnpm build
```

---

## Configuration reference

### Dev launcher

`pnpm dev` sets these for its child processes and reads optional `.env.local` / `.env` from the repository root.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `API_PORT` | No | `8099` | API port chosen by the launcher |
| `WEB_PORT` | No | `3000` | Web port chosen by the launcher |
| `API_REQUEST_LOGS` | No | `true` | Print API request/status/duration lines |

### API

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string (`DB_URL` also accepted) |
| `PORT` | No | `8080` | HTTP listener port when running the API directly |
| `JWT_SECRET` | Production | dev fallback | Access-token signing secret, minimum 32 characters |
| `JWT_ACCESS_TOKEN_EXPIRY` | No | `15m` | Access-token TTL (`15m`, `900s`, `PT15M`, or milliseconds) |
| `JWT_REFRESH_TOKEN_EXPIRY` | No | `7d` | Refresh-token TTL |
| `CORS_ALLOWED_ORIGINS` | Production | `http://localhost:3000,http://127.0.0.1:3000` | Comma-separated allowed origins |
| `STORAGE_PROVIDER` | No | `cloudinary` | `local` or `cloudinary`; local is recommended for development |
| `STORAGE_LOCAL_BASE_PATH` | No | `./data/uploads` | Local upload directory, relative to `apps/api` |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Cloudinary only | — | Cloudinary credentials |
| `STORAGE_RETAIN_SOURCE` | No | `true` | Keep uploaded source files |

### Web

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | Production | `http://localhost:8080` (`8099` under `pnpm dev`) | Browser-facing API base URL; inlined at build time |
| `INTERNAL_API_URL` | No | `NEXT_PUBLIC_API_URL` | Server-side API base URL for RSC/actions/middleware |

---

## Troubleshooting

### `DATABASE_URL (or DB_URL) must be set`

`pnpm dev` reads `DATABASE_URL` from the optional root `.env.local` / `.env` files (or from the shell). If you start the API directly with `pnpm --filter @genesis/api dev`, export `DATABASE_URL` in that terminal or provide the root `.env` file via the launcher.

### `Environment variable JWT_SECRET must be set`

Production (`NODE_ENV=production`) requires `JWT_SECRET`. Set a random value of at least 32 characters.

### Prisma client errors (`@prisma/client did not initialize`)

Generate the client after installing dependencies:

```powershell
pnpm --filter @genesis/api exec prisma generate
```

### Database authentication fails

Confirm the service is running and the username/password/database in `DATABASE_URL` are correct:

```powershell
psql -U postgres -h localhost -d genesis -c "select 1;"
```

### Migration fails partway through

Use a clean database. The baseline is a full schema dump, not an idempotent script. Drop/recreate `genesis`, then re-run Step 2 from `V1`.

### Port 8080 or 3000 is occupied

`pnpm dev` checks `API_PORT` (default `8099`) and `WEB_PORT` (default `3000`) and exits instead of silently choosing another port. Stop the old process, or change the port in `.env`:

```text
API_PORT=8100
WEB_PORT=3001
```

The launcher adjusts `NEXT_PUBLIC_API_URL`, `INTERNAL_API_URL`, and `CORS_ALLOWED_ORIGINS` automatically.

### Frontend still calls the old API URL

`NEXT_PUBLIC_API_URL` is compiled into the client bundle. Stop and restart `pnpm dev` after changing it, and clear `apps/web/.next` if the old value persists.

### `next build` fails with `EPERM ... symlink ... .next\standalone`

This is a Windows symbolic-link privilege issue in Next's standalone tracing, not an application error. Either enable Windows Developer Mode / run with the required privilege, or build without the standalone Docker bundle:

```powershell
$env:NEXT_STANDALONE = "false"
pnpm build
```

Docker builds keep the default standalone output.

### Notifications do not connect

The API exposes SockJS over `/ws` using xhr-polling (there is no native WebSocket transport). Make sure `NEXT_PUBLIC_API_URL` is reachable from the browser and that the API is running. The frontend subscribes to `/user/queue/notifications`.

### Uploads disappear after restart

Local uploads live under `apps/api/data/uploads/`. That directory is git-ignored, so it survives application restarts but is not committed to the repository.
