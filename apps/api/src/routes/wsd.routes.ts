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
  exportAnnotatedOccurrences,
  exportConsensus,
  exportPerAnnotator,
  exportSenses,
  rejectSense,
  rejectionsForDocument,
  unrejectSense,
  listSenses,
  matchAmbiguousWords,
  importSenses,
  searchSenses,
  removeAnnotation,
  removeSense,
  updateSense,
} from "../services/wsd.service.js";
import {
  createSenseSchema,
  createWsdAnnotationSchema,
  matchWordsSchema,
  rejectSenseSchema,
} from "../schemas/wsd.schemas.js";

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

function downloadResponse(file: {
  body: Uint8Array | string;
  contentType: string;
  filename: string;
}): Response {
  return new Response(file.body as never, {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.filename}"`,
    },
  });
}

export const wsdRoutes = new Hono();

wsdRoutes.get("/workspaces/:workspaceId/wsd/senses", authMiddleware, async (c) => {
  const word = c.req.query("word") ?? undefined;
  const query = c.req.query("query") ?? c.req.query("search") ?? undefined;
  const pageParam = c.req.query("page");
  const limitParam = c.req.query("limit");

  if (pageParam !== undefined || limitParam !== undefined || query !== undefined) {
    const page = Math.max(1, parseInt(pageParam || "1", 10) || 1);
    const limit = Math.min(Math.max(1, parseInt(limitParam || "50", 10) || 50), 200);
    return c.json(
      success(
        await searchSenses(needParam(c, "workspaceId"), c.get("userId"), {
          word,
          query,
          page,
          limit,
        }),
      ),
      200,
    );
  }

  return c.json(
    success(await listSenses(needParam(c, "workspaceId"), c.get("userId"), word)),
    200,
  );
});


wsdRoutes.post("/workspaces/:workspaceId/wsd/words/match", authMiddleware, async (c) => {
  const { forms } = parseOrThrow(matchWordsSchema, await c.req.json());
  return c.json(
    success(await matchAmbiguousWords(needParam(c, "workspaceId"), c.get("userId"), forms)),
    200,
  );
});

wsdRoutes.get("/workspaces/:workspaceId/wsd/senses/export", authMiddleware, async (c) => {
  const workspaceId = needParam(c, "workspaceId");
  const format = c.req.query("format") === "csv" ? "csv" : "jsonl";
  const body = await exportSenses(workspaceId, c.get("userId"), format);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type":
        format === "csv" ? "text/csv; charset=utf-8" : "application/x-ndjson; charset=utf-8",
      "Content-Disposition": `attachment; filename="wsd_dictionary_${workspaceId}.${format}"`,
    },
  });
});

wsdRoutes.get(
  "/workspaces/:workspaceId/wsd/export/annotations",
  authMiddleware,
  async (c) => {
    return downloadResponse(
      await exportAnnotatedOccurrences(
        needParam(c, "workspaceId"),
        c.get("userId"),
        c.req.query("format") ?? "csv",
      ),
    );
  },
);

wsdRoutes.post("/workspaces/:workspaceId/wsd/rejections", authMiddleware, async (c) => {
  const input = parseOrThrow(rejectSenseSchema, await c.req.json());
  await rejectSense(needParam(c, "workspaceId"), c.get("userId"), input);
  return c.json(success(null, "Sense rejected"), 200);
});

wsdRoutes.delete("/workspaces/:workspaceId/wsd/rejections/:tokenId/:senseId", authMiddleware, async (c) => {
  await unrejectSense(
    needParam(c, "workspaceId"),
    c.get("userId"),
    needParam(c, "tokenId"),
    needParam(c, "senseId"),
  );
  return c.json(success(null, "Rejection removed"), 200);
});

wsdRoutes.get("/workspaces/:workspaceId/wsd/documents/:documentId/rejections", authMiddleware, async (c) => {
  return c.json(
    success(
      await rejectionsForDocument(
        needParam(c, "workspaceId"),
        c.get("userId"),
        needParam(c, "documentId"),
      ),
    ),
    200,
  );
});

wsdRoutes.post("/workspaces/:workspaceId/wsd/import", authMiddleware, async (c) => {
  const workspaceId = needParam(c, "workspaceId");
  const userId = c.get("userId");
  const modeParam = c.req.query("mode") as "skip" | "overwrite" | undefined;
  const contentType = c.req.header("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const body = await c.req.parseBody();
    const file = body["file"];
    const mode = (body["mode"] as "skip" | "overwrite") || modeParam || "skip";
    const single = Array.isArray(file) ? file[0] : file;
    if (!(single instanceof File)) {
      throw new BadRequestException("Missing file field in multipart upload");
    }
    const bytes = new Uint8Array(await single.arrayBuffer());
    const result = await importSenses(workspaceId, userId, bytes, {
      filename: single.name,
      mode,
    });
    return c.json(success(result), 200);
  }

  const body = await c.req.json().catch(() => null);
  if (!body) {
    throw new BadRequestException("Request body must be multipart/form-data or JSON");
  }

  const entries = Array.isArray(body) ? body : Array.isArray(body.entries) ? body.entries : null;
  if (!entries) {
    throw new BadRequestException("JSON body must contain an array of entries or { entries: [...] }");
  }

  const mode = (body.mode as "skip" | "overwrite") || modeParam || "skip";
  const result = await importSenses(workspaceId, userId, entries, { mode });
  return c.json(success(result), 200);
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
      "Content-Type": "text/tab-separated-values; charset=utf-8",
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
      "Content-Type": "text/tab-separated-values; charset=utf-8",
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
