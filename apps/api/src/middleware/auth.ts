import type { Context, Next } from "hono";
import { verifyAccessToken } from "../lib/jwt.js";
import { UnauthorizedException } from "../common/errors.js";
import { failure } from "../common/response.js";

/**
 * JWT Bearer middleware. Mirrors `JwtAuthenticationFilter`: extracts
 * `Authorization: Bearer <token>`, verifies the signature, and injects the
 * `userId` (UUID) into the Hono context. Missing/invalid/expired tokens
 * yield 401 with an `ApiResponse` body (never 403, never HTML).
 */

declare module "hono" {
  interface ContextVariableMap {
    userId: string;
    username: string;
  }
}

export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  const header = c.req.header("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return c.json(failure("Unauthorized"), 401);
  }
  const token = header.slice("Bearer ".length).trim();
  if (token === "") {
    return c.json(failure("Unauthorized"), 401);
  }
  try {
    const claims = await verifyAccessToken(token);
    c.set("userId", claims.userId);
    c.set("username", claims.username);
  } catch {
    // Expired, malformed, or wrong-signature tokens are all 401 —
    // matches `AuthEntryPoint` behavior on the Java side.
    const err = new UnauthorizedException("Unauthorized");
    return c.json(failure(err.message), 401);
  }
  await next();
}
