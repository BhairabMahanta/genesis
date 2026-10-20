import { PrismaClient } from "@prisma/client";
import { config } from "./config.js";

/**
 * PostgreSQL is the only supported persistence backend. The API refuses to
 * start without a reachable database so a broken deployment cannot silently
 * fall back to process-local state.
 *
 * The schema is owned by the legacy Flyway migrations (`V1`-`V8`); Prisma is
 * used as a typed query client, not as the migration authority.
 */

if (!process.env["DATABASE_URL"] && config.databaseUrl) {
  process.env["DATABASE_URL"] = config.databaseUrl;
}

if (!process.env["DATABASE_URL"]) {
  throw new Error(
    "DATABASE_URL (or DB_URL) must be set. The Genesis API requires PostgreSQL.",
  );
}

export const prisma = new PrismaClient({
  log: config.isProd ? ["warn", "error"] : ["warn", "error"],
});

export async function isDatabaseHealthy(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
