import type { Context, Next } from "hono";
import { config } from "../config.js";

/**
 * CORS middleware mirroring `SecurityConfig.corsConfigurationSource()`:
 * origins from `CORS_ALLOWED_ORIGINS` (comma-separated, no wildcards),
 * credentials allowed, `Content-Disposition` exposed, preflight cached 1h.
 */

const ALLOW_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
const MAX_AGE = "3600";

function isOriginAllowed(origin: string): boolean {
  return config.corsAllowedOrigins.includes(origin);
}

export async function corsMiddleware(c: Context, next: Next): Promise<Response | void> {
  const origin = c.req.header("Origin");

  if (c.req.method === "OPTIONS") {
    const headers = new Headers();
    if (origin && isOriginAllowed(origin)) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Vary", "Origin");
      headers.set("Access-Control-Allow-Credentials", "true");
    }
    headers.set("Access-Control-Allow-Methods", ALLOW_METHODS);
    headers.set(
      "Access-Control-Allow-Headers",
      c.req.header("Access-Control-Request-Headers") ?? "*",
    );
    headers.set("Access-Control-Max-Age", MAX_AGE);
    return new Response(null, { status: 204, headers });
  }

  await next();

  if (origin && isOriginAllowed(origin)) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Vary", "Origin");
    c.header("Access-Control-Allow-Credentials", "true");
    c.header("Access-Control-Expose-Headers", "Content-Disposition");
  }
}
