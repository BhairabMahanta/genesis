import { Hono } from "hono";
import { z } from "zod";
import { BadRequestException } from "../common/errors.js";
import { success } from "../common/response.js";
import { login, logout, me, refresh, signup } from "../services/auth.service.js";
import {
  loginSchema,
  refreshTokenSchema,
  signupSchema,
} from "../schemas/auth.schemas.js";
import { authMiddleware } from "../middleware/auth.js";

/**
 * `/api/auth` routes. Paths, methods, status codes, and messages match
 * `AuthController` exactly so the frontend works unchanged.
 */

function parseOrThrow<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "request";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    throw new BadRequestException("Validation failed", fieldErrors);
  }
  return result.data;
}

export const authRoutes = new Hono();

authRoutes.post("/signup", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const input = parseOrThrow(signupSchema, body);
  const user = await signup(input);
  return c.json(success(user, "User registered successfully"), 201);
});

authRoutes.post("/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const input = parseOrThrow(loginSchema, body);
  const tokens = await login(input);
  return c.json(success(tokens, "Login successful"), 200);
});

authRoutes.post("/refresh", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const input = parseOrThrow(refreshTokenSchema, body);
  const tokens = await refresh(input.refreshToken);
  return c.json(success(tokens, "Token refreshed successfully"), 200);
});

authRoutes.post("/logout", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const input = parseOrThrow(refreshTokenSchema, body);
  await logout(input.refreshToken);
  return c.json(success(null, "Logged out successfully"), 200);
});

authRoutes.get("/me", authMiddleware, async (c) => {
  const user = await me(c.get("userId"));
  return c.json(success(user), 200);
});
