import { Hono } from "hono";
import { z } from "zod";
import { BadRequestException } from "../common/errors.js";
import { success } from "../common/response.js";
import { needParam } from "../common/params.js";
import { authMiddleware } from "../middleware/auth.js";
import {
  createAnnotation,
  createTag,
  listAnnotations,
  listTags,
  removeAnnotation,
  removeTag,
  updateAnnotation,
} from "../services/ner.service.js";
import {
  createNerAnnotationSchema,
  createNerTagSchema,
  updateNerAnnotationSchema,
} from "../schemas/ner.schemas.js";

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

export const nerTagRoutes = new Hono();
export const nerAnnotationRoutes = new Hono();

nerTagRoutes.get("/", authMiddleware, async (c) => {
  const workspaceId = c.req.query("workspaceId") ?? undefined;
  return c.json(success(await listTags(workspaceId)), 200);
});

nerTagRoutes.post("/", authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const input = parseOrThrow(createNerTagSchema, body);
  return c.json(success(await createTag(input)), 200);
});

nerTagRoutes.delete("/:definitionId", authMiddleware, async (c) => {
  await removeTag(needParam(c, "definitionId"));
  return c.json(success(null, "Tag deleted successfully"), 200);
});

nerAnnotationRoutes.get("/", authMiddleware, async (c) => {
  const documentId = c.req.query("documentId");
  if (!documentId) throw new BadRequestException("Missing documentId query parameter");
  const annotatorId = c.req.query("annotatorId") ?? undefined;
  const clean = annotatorId === "" ? undefined : annotatorId;
  return c.json(
    success(await listAnnotations(documentId, c.get("userId"), clean)),
    200,
  );
});

nerAnnotationRoutes.post("/", authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const input = parseOrThrow(createNerAnnotationSchema, body);
  return c.json(success(await createAnnotation(c.get("userId"), input)), 200);
});

nerAnnotationRoutes.patch("/:annotationId", authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const input = parseOrThrow(updateNerAnnotationSchema, body);
  return c.json(
    success(
      await updateAnnotation(needParam(c, "annotationId"), c.get("userId"), input),
    ),
    200,
  );
});

nerAnnotationRoutes.delete("/:annotationId", authMiddleware, async (c) => {
  await removeAnnotation(needParam(c, "annotationId"), c.get("userId"));
  return c.json(success(null, "Annotation deleted successfully"), 200);
});
