import { Hono } from "hono";
import { z } from "zod";
import { BadRequestException } from "../common/errors.js";
import { success } from "../common/response.js";
import { needParam } from "../common/params.js";
import { authMiddleware } from "../middleware/auth.js";
import { dismiss, listRecommendations } from "../services/recommendation.service.js";
import { dismissRecommendationSchema } from "../schemas/export.schemas.js";

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

export const recommendationRoutes = new Hono();

recommendationRoutes.get("/workspaces/:workspaceId/recommendations", authMiddleware, async (c) => {
  return c.json(
    success(await listRecommendations(needParam(c, "workspaceId"), c.get("userId"))),
    200,
  );
});

// Frontend gateway path (canonical).
recommendationRoutes.post("/workspaces/:workspaceId/recommendations/dismissals", authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const input = parseOrThrow(dismissRecommendationSchema, body);
  await dismiss(needParam(c, "workspaceId"), c.get("userId"), input.hash, input.accepted);
  return c.json(success(null, "Recommendation dismissed"), 200);
});

// Legacy Java alias: POST .../recommendations/:hash/dismiss
recommendationRoutes.post("/workspaces/:workspaceId/recommendations/:hash/dismiss", authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const accepted = typeof body?.["accepted"] === "boolean" ? (body["accepted"] as boolean) : false;
  await dismiss(needParam(c, "workspaceId"), c.get("userId"), needParam(c, "hash"), accepted);
  return c.json(success(null, "Recommendation dismissed"), 200);
});
