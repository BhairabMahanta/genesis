import { Hono } from "hono";
import { z } from "zod";
import { BadRequestException, NotFoundException } from "../common/errors.js";
import { success } from "../common/response.js";
import { needParam } from "../common/params.js";
import { authMiddleware } from "../middleware/auth.js";
import { findDocumentById, listSentences, listTokens, updateDocumentEntity } from "../store/prisma.js";
import { processDocument } from "../services/tokenizer/async-processor.js";
import { getStorage } from "../services/storage/index.js";
import {
  closeSession,
  documentContent,
  getSession,
  openWorkspace,
  saveSession,
  workspaceDocuments,
  workspaceStatus,
} from "../services/editor.service.js";
import { saveSessionSchema } from "../schemas/editor.schemas.js";

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

function pageParams(c: { req: { query(k: string): string | undefined } }): { page: number; size: number } {
  const page = Number(c.req.query("page") ?? 0);
  const size = Number(c.req.query("size") ?? 50);
  return {
    page: Number.isFinite(page) ? Math.max(0, Math.trunc(page)) : 0,
    size: Number.isFinite(size) ? Math.min(Math.max(1, Math.trunc(size)), 500) : 50,
  };
}

export const editorRoutes = new Hono();

editorRoutes.post("/editor/workspaces/:workspaceId/open", authMiddleware, async (c) => {
  return c.json(success(await openWorkspace(needParam(c, "workspaceId"), c.get("userId"))), 200);
});

editorRoutes.get("/editor/workspaces/:workspaceId/documents", authMiddleware, async (c) => {
  return c.json(
    success(await workspaceDocuments(needParam(c, "workspaceId"), c.get("userId"))),
    200,
  );
});

editorRoutes.get("/editor/documents/:documentId/content", authMiddleware, async (c) => {
  const { page, size } = pageParams(c);
  return c.json(
    success(
      await documentContent(
        null,
        needParam(c, "documentId"),
        c.get("userId"),
        page,
        size,
      ),
    ),
    200,
  );
});

editorRoutes.get("/editor/workspaces/:workspaceId/documents/:documentId/content", authMiddleware, async (c) => {
  const { page, size } = pageParams(c);
  return c.json(
    success(
      await documentContent(
        needParam(c, "workspaceId"),
        needParam(c, "documentId"),
        c.get("userId"),
        page,
        size,
      ),
    ),
    200,
  );
});

// Internal re-tokenize (mirrors Java's unauthenticated admin hook).
editorRoutes.post("/editor/documents/:documentId/tokenize", async (c) => {
  const documentId = needParam(c, "documentId");
  const doc = await findDocumentById(documentId);
  if (!doc) throw new NotFoundException("Document not found");
  const storage = getStorage();
  // Re-run tokenization from stored content when possible.
  const storedId = doc.storedFileId;
  const { findStoredFileById } = await import("../store/prisma.js");
  const stored = storedId ? await findStoredFileById(storedId) : undefined;
  const content = stored ? await storage.downloadAsString(stored.url) : "";
  const { replaceDocumentContent } = await import("../store/prisma.js");
  const { segment } = await import("../services/tokenizer/sentence-segmenter.js");
  const { tokenize } = await import("../services/tokenizer/unicode-tokenizer.js");
  await updateDocumentEntity(documentId, { processingStatus: "PROCESSING" });
  try {
    const sentenceResults = segment(content ?? "");
    const sentenceRows: Parameters<typeof replaceDocumentContent>[1] = [];
    const tokenRows: Parameters<typeof replaceDocumentContent>[2] = [];
    let globalIndex = 0;
    sentenceResults.forEach((sentence, sentenceIndex) => {
      const tokenResults = tokenize(sentence.text, sentence.startOffset);
      sentenceRows.push({
        sentenceIndex, text: sentence.text, startOffset: sentence.startOffset,
        endOffset: sentence.endOffset, tokenCount: tokenResults.length,
      });
      tokenResults.forEach((token, tokenIndex) => {
        tokenRows.push({
          sentenceIndex, tokenIndex, globalIndex: globalIndex++, form: token.text,
          pos: null, lemma: null, nerTag: null, startOffset: token.startOffset, endOffset: token.endOffset,
        });
      });
    });
    await replaceDocumentContent(documentId, sentenceRows, tokenRows);
    await updateDocumentEntity(documentId, {
      processingStatus: "COMPLETED",
      processingError: null,
    });
  } catch (err) {
    await updateDocumentEntity(documentId, {
      processingStatus: "FAILED",
      processingError: err instanceof Error ? err.message.slice(0, 900) : "Tokenization failed",
    });
  }
  return c.json(
    success({
      documentId,
      sentenceCount: (await listSentences(documentId)).length,
      tokenCount: (await listTokens(documentId)).length,
      success: true,
    }),
    200,
  );
});

editorRoutes.get("/editor/workspaces/:workspaceId/session", authMiddleware, async (c) => {
  const session = await getSession(needParam(c, "workspaceId"), c.get("userId"));
  if (!session) throw new NotFoundException("Session not found");
  return c.json(success(session), 200);
});

editorRoutes.post("/editor/session", authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const input = parseOrThrow(saveSessionSchema, body);
  return c.json(success(await saveSession(c.get("userId"), input)), 200);
});

editorRoutes.delete("/editor/workspaces/:workspaceId/session", authMiddleware, async (c) => {
  await closeSession(needParam(c, "workspaceId"), c.get("userId"));
  return c.body(null, 204);
});

editorRoutes.get("/editor/workspaces/:workspaceId/status", authMiddleware, async (c) => {
  return c.json(
    success(await workspaceStatus(needParam(c, "workspaceId"), c.get("userId"))),
    200,
  );
});

export { processDocument };
