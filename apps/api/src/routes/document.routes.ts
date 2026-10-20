import { Hono } from "hono";
import { BadRequestException } from "../common/errors.js";
import { success } from "../common/response.js";
import { config } from "../config.js";
import { needParam } from "../common/params.js";
import { authMiddleware } from "../middleware/auth.js";
import {
  countWorkspaceDocuments,
  deleteDocument,
  getDocument,
  listWorkspaceDocuments,
  updateDocumentStatus,
  uploadDocument,
} from "../services/document.service.js";

/**
 * Document routes. Paths and methods match `DocumentController`
 * (`@RequestMapping("/api")`): uploads are `multipart/form-data` with the
 * file in field `file`, capped at 50MB like the Spring backend.
 *
 * Auth is applied per-route (not via `use("*")`) so the guard does not
 * leak onto `/api/health` or `/api/auth` when this router is mounted
 * under `/api`.
 */

export const documentRoutes = new Hono();

async function readUploadFile(body: Record<string, unknown>): Promise<{
  bytes: Uint8Array;
  filename: string;
  contentType: string | null;
}> {
  const file = body["file"];
  const single = Array.isArray(file) ? file[0] : file;
  if (!(single instanceof File)) {
    throw new BadRequestException("Missing file field in multipart upload");
  }
  if (single.size > config.maxUploadBytes) {
    throw new BadRequestException("File exceeds the 50MB upload limit");
  }
  const buffer = new Uint8Array(await single.arrayBuffer());
  return {
    bytes: buffer,
    filename: single.name || "upload",
    contentType: single.type || null,
  };
}

documentRoutes.post(
  "/workspaces/:workspaceId/documents",
  authMiddleware,
  async (c) => {
    const parsed = (await c.req.parseBody()) as Record<string, unknown>;
    const file = await readUploadFile(parsed);
    const doc = await uploadDocument(needParam(c, "workspaceId"), c.get("userId"), file);
    return c.json(success(doc, "Document uploaded successfully"), 201);
  },
);

documentRoutes.get(
  "/workspaces/:workspaceId/documents",
  authMiddleware,
  async (c) => {
    const docs = await listWorkspaceDocuments(
      needParam(c, "workspaceId"),
      c.get("userId"),
    );
    return c.json(success(docs), 200);
  },
);

documentRoutes.get(
  "/workspaces/:workspaceId/documents/count",
  authMiddleware,
  async (c) => {
    const count = await countWorkspaceDocuments(
      needParam(c, "workspaceId"),
      c.get("userId"),
    );
    return c.json(success(count), 200);
  },
);

documentRoutes.get("/documents/:id", authMiddleware, async (c) => {
  return c.json(
    success(await getDocument(needParam(c, "id"), c.get("userId"))),
    200,
  );
});

documentRoutes.put("/documents/:id/status", authMiddleware, async (c) => {
  const status = c.req.query("status");
  if (!status) {
    throw new BadRequestException("Missing status query parameter");
  }
  return c.json(
    success(
      await updateDocumentStatus(needParam(c, "id"), c.get("userId"), status),
    ),
    200,
  );
});

documentRoutes.delete("/documents/:id", authMiddleware, async (c) => {
  await deleteDocument(needParam(c, "id"), c.get("userId"));
  return c.json(success(null, "Document deleted successfully"), 200);
});
