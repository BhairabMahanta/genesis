import { Hono } from "hono";
import { z } from "zod";
import { BadRequestException } from "../common/errors.js";
import { success } from "../common/response.js";
import { needParam } from "../common/params.js";
import { authMiddleware } from "../middleware/auth.js";
import {
  assignMention,
  createCluster,
  createMention,
  getCluster,
  getMention,
  listClusterMentions,
  listClustersCursor,
  listDocumentMentions,
  listMentionsCursor,
  listUnassigned,
  merge,
  removeCluster,
  removeMention,
  renameCluster,
  stats,
  unassignMention,
} from "../services/coref.service.js";
import {
  createClusterSchema,
  createMentionSchema,
  mergeClustersSchema,
} from "../schemas/coref.schemas.js";

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

export const corefRoutes = new Hono();

function limitOf(c: { req: { query(k: string): string | undefined } }): number {
  const raw = c.req.query("limit");
  if (!raw) return 100;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new BadRequestException("Invalid limit");
  return Math.trunc(n);
}

corefRoutes.post("/workspaces/:workspaceId/mentions", authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const input = parseOrThrow(createMentionSchema, body);
  return c.json(
    success(await createMention(needParam(c, "workspaceId"), c.get("userId"), input)),
    200,
  );
});

corefRoutes.get("/workspaces/:workspaceId/mentions", authMiddleware, async (c) => {
  const cursor = c.req.query("cursor") ?? undefined;
  return c.json(
    success(
      await listMentionsCursor(
        needParam(c, "workspaceId"),
        c.get("userId"),
        cursor,
        limitOf(c),
      ),
    ),
    200,
  );
});

corefRoutes.get("/workspaces/:workspaceId/mentions/unassigned", authMiddleware, async (c) => {
  return c.json(
    success(await listUnassigned(needParam(c, "workspaceId"), c.get("userId"))),
    200,
  );
});

corefRoutes.get("/documents/:documentId/mentions", authMiddleware, async (c) => {
  return c.json(
    success(await listDocumentMentions(needParam(c, "documentId"), c.get("userId"))),
    200,
  );
});

corefRoutes.get("/mentions/:mentionId", authMiddleware, async (c) => {
  return c.json(
    success(await getMention(needParam(c, "mentionId"), c.get("userId"))),
    200,
  );
});

corefRoutes.put("/mentions/:mentionId/cluster/:clusterId", authMiddleware, async (c) => {
  return c.json(
    success(
      await assignMention(
        needParam(c, "mentionId"),
        needParam(c, "clusterId"),
        c.get("userId"),
      ),
    ),
    200,
  );
});

corefRoutes.delete("/mentions/:mentionId/cluster", authMiddleware, async (c) => {
  return c.json(
    success(await unassignMention(needParam(c, "mentionId"), c.get("userId"))),
    200,
  );
});

corefRoutes.delete("/mentions/:mentionId", authMiddleware, async (c) => {
  await removeMention(needParam(c, "mentionId"), c.get("userId"));
  return c.body(null, 204);
});

corefRoutes.post("/workspaces/:workspaceId/clusters", authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const input = parseOrThrow(createClusterSchema, body ?? {});
  return c.json(
    success(await createCluster(needParam(c, "workspaceId"), c.get("userId"), input)),
    200,
  );
});

corefRoutes.get("/workspaces/:workspaceId/clusters", authMiddleware, async (c) => {
  const raw = c.req.query("cursor");
  const cursor = raw == null || raw === "" ? undefined : Number(raw);
  return c.json(
    success(
      await listClustersCursor(
        needParam(c, "workspaceId"),
        c.get("userId"),
        cursor,
        limitOf(c),
      ),
    ),
    200,
  );
});

corefRoutes.post("/workspaces/:workspaceId/clusters/merge", authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const input = parseOrThrow(mergeClustersSchema, body);
  return c.json(
    success(await merge(needParam(c, "workspaceId"), c.get("userId"), input)),
    200,
  );
});

corefRoutes.get("/clusters/:clusterId", authMiddleware, async (c) => {
  return c.json(
    success(await getCluster(needParam(c, "clusterId"), c.get("userId"))),
    200,
  );
});

corefRoutes.get("/clusters/:clusterId/mentions", authMiddleware, async (c) => {
  return c.json(
    success(await listClusterMentions(needParam(c, "clusterId"), c.get("userId"))),
    200,
  );
});

corefRoutes.put("/clusters/:clusterId", authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const input = parseOrThrow(createClusterSchema, body);
  return c.json(
    success(await renameCluster(needParam(c, "clusterId"), c.get("userId"), input)),
    200,
  );
});

corefRoutes.delete("/clusters/:clusterId", authMiddleware, async (c) => {
  await removeCluster(needParam(c, "clusterId"), c.get("userId"));
  return c.body(null, 204);
});

corefRoutes.get("/workspaces/:workspaceId/coref/stats", authMiddleware, async (c) => {
  return c.json(
    success(await stats(needParam(c, "workspaceId"), c.get("userId"))),
    200,
  );
});
