import { Hono } from "hono";
import { jwtVerify } from "jose";
import { BadRequestException, NotFoundException } from "../common/errors.js";
import { success } from "../common/response.js";
import { needParam } from "../common/params.js";
import { authMiddleware } from "../middleware/auth.js";
import { config } from "../config.js";
import {
  findWorkspaceById,
  listDocumentsByWorkspace,
  listSentences,
  listTokens,
} from "../store/prisma.js";
import { exportDocument, exportWorkspace, issueShareToken } from "../services/export.service.js";
import { exportOptionsSchema } from "../schemas/export.schemas.js";
import { majorityByDocumentInternal } from "../services/pos.service.js";
import {
  corefAnnotationsForDocument,
  exportMergedText,
  sanitizeFilename,
  type DocumentExportData,
} from "../services/conll-exporter.js";
import type { TokenEntity } from "../store/types.js";

export const exportRoutes = new Hono();

export const shareExportRoutes = new Hono();

function downloadResponse(result: { filename: string; contentType: string; content: string | Uint8Array }): Response {
  return new Response(result.content, {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Content-Disposition": `attachment; filename="${result.filename}"`,
    },
  });
}

exportRoutes.post("/export/documents/:documentId", authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const options = exportOptionsSchema.safeParse(body ?? {}).success
    ? exportOptionsSchema.parse(body ?? {})
    : {};
  return downloadResponse(
    await exportDocument(needParam(c, "documentId"), c.get("userId"), options),
  );
});

exportRoutes.post("/export/workspaces/:workspaceId", authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const options = exportOptionsSchema.safeParse(body ?? {}).success
    ? exportOptionsSchema.parse(body ?? {})
    : {};
  return downloadResponse(
    await exportWorkspace(needParam(c, "workspaceId"), c.get("userId"), options),
  );
});

exportRoutes.post("/workspaces/:workspaceId/export/share", authMiddleware, async (c) => {
  const result = await issueShareToken(needParam(c, "workspaceId"), c.get("userId"));
  return c.json(success(result), 200);
});

// Public download via 24h share token (no auth header required).
// Mirrors `ShareExportController.downloadWithShareToken`: merged export,
// default options, access verified solely via the signed token.
shareExportRoutes.get("/public/export/conll/:workspaceId", async (c) => {
  const workspaceId = needParam(c, "workspaceId");
  const token = c.req.query("token");
  if (!token) throw new BadRequestException("Missing token query parameter");
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(config.jwtSecret), {
      algorithms: ["HS256"],
    });
    if (payload["workspace_id"] !== workspaceId) {
      throw new BadRequestException("Invalid share token");
    }
  } catch (err) {
    if (err instanceof BadRequestException) throw err;
    throw new BadRequestException("Invalid or expired share token");
  }
  const ws = await findWorkspaceById(workspaceId);
  if (!ws) throw new NotFoundException("Workspace not found");
  const docs = await listDocumentsByWorkspace(workspaceId);
  const datas: DocumentExportData[] = await Promise.all(
    docs.map(async (doc) => {
      const bySentence = new Map<number, TokenEntity[]>();
      for (const token of await listTokens(doc.id)) {
        const list = bySentence.get(token.sentenceIndex) ?? [];
        list.push(token);
        bySentence.set(token.sentenceIndex, list);
      }
      return {
        documentName: doc.name,
        sentences: await listSentences(doc.id),
        tokensBySentence: bySentence,
        corefAnnotations: await corefAnnotationsForDocument(doc.id),
        posOverrides: new Map(
          Object.entries(await majorityByDocumentInternal(doc.id)),
        ),
      };
    }),
  );
  return downloadResponse({
    filename: `${sanitizeFilename(ws.name)}.conll`,
    contentType: "text/plain; charset=UTF-8",
    content: exportMergedText(datas, {
      column2Mode: "PART_NUMBER",
      continueSentenceNumbers: true,
      defaultPartNumber: 0,
    }),
  });
});
