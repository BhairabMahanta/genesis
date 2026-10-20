import { Hono } from "hono";
import { z } from "zod";
import { BadRequestException } from "../common/errors.js";
import { success } from "../common/response.js";
import { needParam } from "../common/params.js";
import { authMiddleware } from "../middleware/auth.js";
import {
  annotate,
  annotationsForDocument,
  annotationsForToken,
  createSense,
  exportConsensus,
  exportPerAnnotator,
  listSenses,
  removeAnnotation,
  removeSense,
  updateSense,
} from "../services/wsd.service.js";
import { createSenseSchema, createWsdAnnotationSchema } from "../schemas/wsd.schemas.js";

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

export const wsdRoutes = new Hono();

wsdRoutes.get("/workspaces/:workspaceId/wsd/senses", authMiddleware, async (c) => {
  const word = c.req.query("word") ?? undefined;
  return c.json(
    success(await listSenses(needParam(c, "workspaceId"), c.get("userId"), word)),
    200,
  );
});

wsdRoutes.post("/workspaces/:workspaceId/wsd/senses", authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const input = parseOrThrow(createSenseSchema, body);
  return c.json(
    success(await createSense(needParam(c, "workspaceId"), c.get("userId"), input)),
    200,
  );
});

wsdRoutes.put("/workspaces/:workspaceId/wsd/senses/:senseId", authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const input = parseOrThrow(createSenseSchema, body);
  return c.json(
    success(
      await updateSense(
        needParam(c, "workspaceId"),
        c.get("userId"),
        needParam(c, "senseId"),
        input,
      ),
    ),
    200,
  );
});

wsdRoutes.delete("/workspaces/:workspaceId/wsd/senses/:senseId", authMiddleware, async (c) => {
  await removeSense(needParam(c, "workspaceId"), c.get("userId"), needParam(c, "senseId"));
  return c.json(success(null, "Sense deleted successfully"), 200);
});

wsdRoutes.post("/workspaces/:workspaceId/wsd/annotations", authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const input = parseOrThrow(createWsdAnnotationSchema, body);
  return c.json(
    success(await annotate(needParam(c, "workspaceId"), c.get("userId"), input)),
    200,
  );
});

wsdRoutes.get("/workspaces/:workspaceId/wsd/tokens/:tokenId/annotations", authMiddleware, async (c) => {
  return c.json(
    success(
      await annotationsForToken(
        needParam(c, "workspaceId"),
        c.get("userId"),
        needParam(c, "tokenId"),
      ),
    ),
    200,
  );
});

wsdRoutes.get("/workspaces/:workspaceId/wsd/documents/:documentId/annotations", authMiddleware, async (c) => {
  return c.json(
    success(
      await annotationsForDocument(
        needParam(c, "workspaceId"),
        c.get("userId"),
        needParam(c, "documentId"),
      ),
    ),
    200,
  );
});

wsdRoutes.delete("/workspaces/:workspaceId/wsd/annotations/:annotationId", authMiddleware, async (c) => {
  await removeAnnotation(
    needParam(c, "workspaceId"),
    c.get("userId"),
    needParam(c, "annotationId"),
  );
  return c.json(success(null, "Annotation deleted successfully"), 200);
});

wsdRoutes.get("/workspaces/:workspaceId/wsd/export", authMiddleware, async (c) => {
  const workspaceId = needParam(c, "workspaceId");
  const tsv = await exportPerAnnotator(workspaceId, c.get("userId"));
  return new Response(tsv, {
    status: 200,
    headers: {
      "Content-Type": "text/tab-separated-values",
      "Content-Disposition": `attachment; filename="wsd_annotations_${workspaceId}.tsv"`,
    },
  });
});

wsdRoutes.get("/workspaces/:workspaceId/wsd/export/consensus", authMiddleware, async (c) => {
  const workspaceId = needParam(c, "workspaceId");
  const tsv = await exportConsensus(workspaceId, c.get("userId"));
  return new Response(tsv, {
    status: 200,
    headers: {
      "Content-Type": "text/tab-separated-values",
      "Content-Disposition": `attachment; filename="wsd_consensus_${workspaceId}.tsv"`,
    },
  });
});

// Extra aliases from BACKEND_MIGRATION.md §3.4 (kept for client compat).
wsdRoutes.get("/workspaces/:workspaceId/wsd/annotations/:tokenId", authMiddleware, async (c) => {
  return c.json(
    success(
      await annotationsForToken(
        needParam(c, "workspaceId"),
        c.get("userId"),
        needParam(c, "tokenId"),
      ),
    ),
    200,
  );
});

wsdRoutes.post("/workspaces/:workspaceId/wsd/annotate", authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const input = parseOrThrow(createWsdAnnotationSchema, body);
  return c.json(
    success(await annotate(needParam(c, "workspaceId"), c.get("userId"), input)),
    200,
  );
});
