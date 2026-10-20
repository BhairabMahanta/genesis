import { Hono } from "hono";
import { z } from "zod";
import { BadRequestException } from "../common/errors.js";
import { success } from "../common/response.js";
import { needParam } from "../common/params.js";
import { authMiddleware } from "../middleware/auth.js";
import {
  batchUpdate,
  createTag,
  getByDocument,
  getByToken,
  listTags,
  majorityByDocument,
  removeTag,
  updateTokenPos,
} from "../services/pos.service.js";
import {
  batchUpdatePosSchema,
  createPosTagSchema,
  updatePosSchema,
} from "../schemas/pos.schemas.js";

function parseOrThrow<S extends z.ZodTypeAny>(schema: S, body: unknown): z.output<S> {
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

export const posTagRoutes = new Hono();
export const posAnnotationRoutes = new Hono();

posTagRoutes.get("/", authMiddleware, async (c) => {
  const workspaceId = c.req.query("workspaceId") ?? undefined;
  return c.json(success(await listTags(workspaceId)), 200);
});

posTagRoutes.post("/", authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(success(await createTag(parseOrThrow(createPosTagSchema, body))), 200);
});

posTagRoutes.delete("/:definitionId", authMiddleware, async (c) => {
  await removeTag(needParam(c, "definitionId"));
  return c.json(success(null, "Tag deleted successfully"), 200);
});

posAnnotationRoutes.put("/tokens/pos/batch", authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const input = parseOrThrow(batchUpdatePosSchema, body);
  return c.json(success(await batchUpdate(c.get("userId"), input.updates)), 200);
});

posAnnotationRoutes.put("/tokens/:tokenId/pos", authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const input = parseOrThrow(updatePosSchema, body);
  return c.json(
    success(await updateTokenPos(needParam(c, "tokenId"), c.get("userId"), input.pos)),
    200,
  );
});

posAnnotationRoutes.get("/tokens/:tokenId/pos", authMiddleware, async (c) => {
  return c.json(
    success(await getByToken(needParam(c, "tokenId"), c.get("userId"))),
    200,
  );
});

posAnnotationRoutes.get("/documents/:documentId/pos", authMiddleware, async (c) => {
  return c.json(
    success(await getByDocument(needParam(c, "documentId"), c.get("userId"))),
    200,
  );
});

posAnnotationRoutes.get("/documents/:documentId/pos/majority", authMiddleware, async (c) => {
  return c.json(
    success(await majorityByDocument(needParam(c, "documentId"), c.get("userId"))),
    200,
  );
});
