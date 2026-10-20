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
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
    console.error(`[dev] Stop the existing process or set ${variable} to a free port.`);
    process.exit(1);
  }
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
