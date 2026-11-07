#!/usr/bin/env node
/**
 * Local development launcher.
 *
 * `pnpm dev`            -> API + web, prefixed logs, fixed ports
 * `pnpm dev:api`        -> API only
 * `pnpm dev:web`        -> web only
 *
 * Reads optional `.env.local` / `.env` files from the repository root.
 * Existing process environment variables always win over file values.
 */
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2] ?? "all";

if (!["all", "api", "web"].includes(mode)) {
  console.error(`[dev] Unknown mode "${mode}". Use one of: all, api, web.`);
  process.exit(1);
}

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (process.env[key] !== undefined) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      const comment = value.indexOf(" #");
      if (comment >= 0) value = value.slice(0, comment).trim();
    }
    process.env[key] = value;
  }
}

// `.env.local` is the higher-precedence local override; `.env` fills the rest.
loadEnvFile(path.join(root, ".env.local"));
loadEnvFile(path.join(root, ".env"));

const apiPort = process.env.API_PORT ?? "8099";
const webPort = process.env.WEB_PORT ?? "3000";
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? `http://localhost:${apiPort}`;
const internalApiUrl = process.env.INTERNAL_API_URL ?? apiUrl;
// The API we start ourselves always listens here, whatever NEXT_PUBLIC_API_URL says.
const localApiUrl = `http://localhost:${apiPort}`;

const baseEnv = {
  ...process.env,
  API_REQUEST_LOGS: process.env.API_REQUEST_LOGS ?? "true",
  NEXT_PUBLIC_API_URL: apiUrl,
  INTERNAL_API_URL: internalApiUrl,
  CORS_ALLOWED_ORIGINS:
    process.env.CORS_ALLOWED_ORIGINS ??
    `http://localhost:${webPort},http://127.0.0.1:${webPort}`,
  // Local disk is the safe development default; set STORAGE_PROVIDER=cloudinary
  // in `.env` to exercise the Cloudinary path.
  STORAGE_PROVIDER: process.env.STORAGE_PROVIDER ?? "local",
  NEXT_TELEMETRY_DISABLED: "1",
};

if (!baseEnv.DATABASE_URL && !baseEnv.DB_URL) {
  baseEnv.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/genesis";
}
if (!baseEnv.JWT_SECRET) {
  baseEnv.JWT_SECRET = "dev-only-insecure-secret-min-32-chars-long!!";
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function docker(args, { timeout = 0 } = {}) {
  const result = spawnSync("docker", args, {
    cwd: root,
    env: baseEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
  });
  const stdout = (result.stdout ?? "").trim();
  const stderr = (result.stderr ?? "").trim();
  return {
    ok: result.status === 0 && !result.error,
    stdout,
    stderr,
    out: [stdout, stderr].filter(Boolean).join("\n"),
  };
}

function containerStatus(name) {
  const result = docker([
    "inspect",
    "-f",
    "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
    name,
  ]);
  return result.ok ? result.stdout : null;
}

// Auto-start the compose database only when DATABASE_URL points at the local
// compose port. A remote or non-default database is used as-is.
function usesLocalDatabase() {
  try {
    const url = new URL(baseEnv.DATABASE_URL);
    const port = url.port || "5432";
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) && port === "5432";
  } catch {
    return false;
  }
}

function dockerEnabled() {
  const setting = (process.env.DEV_DOCKER ?? "auto").toLowerCase();
  if (["false", "0", "no", "off"].includes(setting)) return false;
  if (["true", "1", "yes", "on"].includes(setting)) return true;
  return usesLocalDatabase();
}

function warn(message) {
  console.warn(`[dev] ${message}`);
}

function dockerDesktopPath() {
  if (process.platform === "win32") {
    const candidates = [
      path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Docker", "Docker", "Docker Desktop.exe"),
      path.join(process.env.LOCALAPPDATA ?? "", "Programs", "DockerDesktop", "Docker Desktop.exe"),
      path.join(process.env.LOCALAPPDATA ?? "", "Docker", "Docker Desktop.exe"),
    ];
    return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null;
  }
  if (process.platform === "darwin") {
    return existsSync("/Applications/Docker.app") ? "/Applications/Docker.app" : null;
  }
  return null;
}

async function startDockerDaemon(timeoutMs = 180_000) {
  console.log("[dev] Docker is not running; starting Docker Desktop...");

  // `docker desktop start` starts the engine and waits for it (Docker Desktop 4.37+).
  const cli = docker(["desktop", "start"], { timeout: timeoutMs });
  for (const line of cli.out.split(/\r?\n/)) {
    if (line.trim()) console.log(`[docker] ${line}`);
  }
  if (cli.ok && docker(["info", "--format", "{{.ServerVersion}}"]).ok) return true;

  // Older installations: launch the app, then poll the engine.
  const target = dockerDesktopPath();
  if (!target) return false;
  console.log(`[dev] launching ${target}`);
  if (process.platform === "darwin") {
    spawn("open", ["-a", target], { stdio: "ignore", detached: true }).unref();
  } else {
    spawn(target, [], { stdio: "ignore", detached: true }).unref();
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(3000);
    if (docker(["info", "--format", "{{.ServerVersion}}"]).ok) {
      console.log("[dev] Docker is ready");
      return true;
    }
  }
  return false;
}

async function waitForDatabase(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (containerStatus("genesis-db") === "healthy") return true;
    await sleep(1000);
  }
  return false;
}

// Bring up PostgreSQL + migrations from docker-compose.yml before the API starts.
// Every failure is non-fatal: the API prints its own connection errors, and the
// developer may be using a database we cannot manage.
async function ensureLocalDatabase() {
  if (!dockerEnabled()) {
    console.log("[dev] Docker bootstrap off; using DATABASE_URL as configured.");
    return;
  }
  if (!docker(["--version"]).ok) {
    warn("Docker CLI not found, skipping the database container.");
    warn("Install Docker Desktop, or set DEV_DOCKER=false and run PostgreSQL yourself.");
    return;
  }
  if (!docker(["compose", "version"]).ok) {
    warn("`docker compose` is unavailable, skipping the database container.");
    return;
  }
  if (!docker(["info", "--format", "{{.ServerVersion}}"]).ok) {
    if (!(await startDockerDaemon())) {
      warn("Docker is installed but its daemon is not running.");
      warn("Start Docker Desktop, or set DEV_DOCKER=false and run PostgreSQL yourself.");
      return;
    }
  }

  // `docker compose` reads POSTGRES_PASSWORD from `.env` (not `.env.local`).
  const envFile = path.join(root, ".env");
  const envExample = path.join(root, ".env.example");
  if (!existsSync(envFile) && existsSync(envExample)) {
    copyFileSync(envExample, envFile);
    console.log("[dev] created .env from .env.example");
  }

  if (containerStatus("genesis-db") === "healthy") {
    console.log("[dev] database container already running (genesis-db)");
  } else {
    console.log("[dev] starting database container (genesis-db)...");
    const up = docker(["compose", "up", "-d", "db"]);
    if (!up.ok) {
      warn(`could not start the database container:\n${indent(up.out)}`);
      return;
    }
    if (!(await waitForDatabase())) {
      warn("database container did not become healthy within 60s; continuing anyway.");
    }
  }

  console.log("[dev] applying migrations...");
  const migrated = docker(["compose", "run", "--rm", "--no-deps", "migrate"]);
  if (migrated.out) {
    for (const line of migrated.out.split(/\r?\n/)) {
      if (line.trim()) console.log(`[docker] ${line}`);
    }
  }
  if (!migrated.ok) {
    warn("migrations failed; the API may not start. See the [docker] output above.");
  }
}

function indent(text) {
  return text.split(/\r?\n/).map((line) => `  ${line}`).join("\n");
}

async function waitForApi(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${localApiUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return true;
    } catch {
      // API still starting, or the port is not listening yet.
    }
    await sleep(1000);
  }
  return false;
}

const colorEnabled = process.stdout.isTTY && !process.env.NO_COLOR;
const colors = {
  backend: "\x1b[34m",
  frontend: "\x1b[32m",
  reset: "\x1b[0m",
};

function prefixFor(name) {
  const label = `[${name.toUpperCase()}]`;
  return colorEnabled && name in colors ? `${colors[name]}${label}${colors.reset}` : label;
}

function prefixStream(stream, prefix, target) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      target.write(`${prefix} ${line}\n`);
    }
  });
  stream.on("end", () => {
    if (buffer.length > 0) target.write(`${prefix} ${buffer}\n`);
  });
}

function portAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(Number(port));
  });
}

const checks = [];
if (mode !== "web") checks.push(["backend", apiPort]);
if (mode !== "api") checks.push(["frontend", webPort]);

for (const [name, port] of checks) {
  if (!(await portAvailable(port))) {
    const variable = name === "backend" ? "API_PORT" : "WEB_PORT";
    console.error(`[dev] ${name} port ${port} is already in use.`);
    if (name === "backend" && docker(["inspect", "-f", "{{.State.Running}}", "genesis-api"]).stdout === "true") {
      console.error("[dev] The Docker API container (genesis-api) owns this port.");
      console.error("[dev] Run `pnpm dev:web` for the frontend only, or `docker compose stop api`.");
    } else {
      console.error(`[dev] Stop the existing process or set ${variable} to a free port.`);
    }
    process.exit(1);
  }
}

if (mode !== "web") {
  await ensureLocalDatabase();
}

console.log(
  `[dev] ${mode === "web" ? "expecting backend" : "backend"}  http://localhost:${apiPort}`,
);
if (mode !== "api") console.log(`[dev] frontend http://localhost:${webPort}`);
try {
  const database = new URL(baseEnv.DATABASE_URL);
  console.log(`[dev] database ${database.hostname}:${database.port || "5432"}${database.pathname}`);
} catch {
  // Non-URL database values are validated by the API itself.
}
console.log("[dev] Press Ctrl+C to stop all processes.\n");

let shuttingDown = false;
const children = new Set();

function killTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      shell: true,
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\n[dev] stopping backend/frontend...");
  for (const child of children) killTree(child);
  setTimeout(() => process.exit(code), 800).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function pnpmInvocation(args) {
  const execPath = process.env.npm_execpath;
  if (!execPath) {
    // Direct `node scripts/dev.mjs` (not through a package script) on Windows.
    if (process.platform === "win32") {
      const quoted = args.map((arg) => `"${arg.replace(/"/g, '\\"')}"`).join(" ");
      return {
        command: process.env.ComSpec ?? "cmd.exe",
        args: ["/d", "/s", "/c", `pnpm ${quoted}`],
      };
    }
    return { command: "pnpm", args };
  }
  // pnpm may expose a JS entry point (corepack/local install) or a native
  // executable (global install). Run JS through Node; otherwise execute it
  // directly. `.cmd` shims still need cmd.exe on Windows.
  if (/\.(?:c?js|mjs)$/i.test(execPath)) {
    return { command: process.execPath, args: [execPath, ...args] };
  }
  if (/\.cmd$/i.test(execPath)) {
    const quoted = args.map((arg) => `"${arg.replace(/"/g, '\\"')}"`).join(" ");
    return {
      command: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", `"${execPath}" ${quoted}`],
    };
  }
  return { command: execPath, args };
}

function start(name, args, env) {
  const invocation = pnpmInvocation(args);
  const child = spawn(invocation.command, invocation.args, {
    cwd: root,
    env,
    stdio: ["inherit", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  children.add(child);
  const prefix = prefixFor(name);
  prefixStream(child.stdout, prefix, process.stdout);
  prefixStream(child.stderr, prefix, process.stderr);
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;
    console.log(`${prefix} exited (${signal ?? code ?? "unknown"})`);
    shutdown(code ?? 1);
  });
  return child;
}

// Create the development demo account once the API answers. Skipped with
// DEV_SEED_DEMO=false, and never runs in `dev:web` (the API is not ours there).
async function seedDemo() {
  if (process.env.NODE_ENV === "production") {
    console.log("[seed] skipped (NODE_ENV=production)");
    return;
  }
  if (["false", "0", "no", "off"].includes((process.env.DEV_SEED_DEMO ?? "").toLowerCase())) {
    console.log("[seed] skipped (DEV_SEED_DEMO is off)");
    return;
  }
  console.log("[seed] waiting for the API to become healthy...");
  if (!(await waitForApi())) {
    warn("API was not healthy within 90s; run `pnpm seed:demo` once it is up.");
    return;
  }
  const child = spawn(process.execPath, [path.join(root, "scripts", "seed-demo.mjs")], {
    cwd: root,
    env: { ...baseEnv, API_URL: localApiUrl, WEB_URL: `http://localhost:${webPort}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  const prefix = prefixFor("seed");
  prefixStream(child.stdout, prefix, process.stdout);
  prefixStream(child.stderr, prefix, process.stderr);
  child.on("exit", (code) => {
    children.delete(child);
    if (shuttingDown) return;
    if (code === 0) console.log("[seed] demo login: demo (or demo@genesis.local) / Demo@12345");
    else warn("demo seeding failed; run `pnpm seed:demo` once the API is up to retry.");
  });
}

if (mode !== "web") {
  start("backend", ["--filter", "@genesis/api", "dev"], {
    ...baseEnv,
    PORT: apiPort,
  });
}
if (mode !== "api") {
  start(
    "frontend",
    ["--filter", "@genesis/web", "exec", "next", "dev", "-p", webPort],
    {
      ...baseEnv,
      PORT: webPort,
    },
  );
}
if (mode !== "web") {
  void seedDemo();
}
