import type { Context } from "hono";
import { HttpException } from "../common/errors.js";
import { failure } from "../common/response.js";

/**
 * Global error handler. Every error leaves the API as an `ApiResponse`-shaped
 * JSON body — never HTML, never a bare stack trace.
 */
export function errorHandler(err: Error, c: Context): Response {
  if (err instanceof HttpException) {
    return c.json(failure(err.message, err.fieldErrors), err.status as 400);
  }
  console.error(`Unhandled error on ${c.req.method} ${c.req.path}:`, err);
  return c.json(failure("Internal server error"), 500);
}

/** 404 fallback — also `ApiResponse`-shaped, matching the Phase 1 test. */
export function notFoundHandler(c: Context): Response {
  return c.json(failure("Not Found"), 404);
}
