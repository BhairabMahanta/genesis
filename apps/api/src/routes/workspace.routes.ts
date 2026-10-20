import { Hono } from "hono";
import { z } from "zod";
import { BadRequestException } from "../common/errors.js";
import { success } from "../common/response.js";
import { needParam } from "../common/params.js";
import { authMiddleware } from "../middleware/auth.js";
import {
  addWorkspaceMember,
  changeMemberRole,
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listWorkspaceMembers,
  listWorkspaces,
  removeWorkspaceMember,
  updateWorkspace,
  updateWorkspaceStatus,
} from "../services/workspace.service.js";
import {
  addMemberSchema,
  createWorkspaceSchema,
  memberRoleSchema,
  updateWorkspaceSchema,
  workspaceStatusSchema,
} from "../schemas/workspace.schemas.js";

/**
 * `/api/workspaces` routes. Paths, methods, and status codes match
 * `WorkspaceController` exactly.
 *
 * Auth is applied per-route (not via `use("*")`) so the guard cannot leak
 * onto sibling paths when this router is mounted under `/api/workspaces`.
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

export const workspaceRoutes = new Hono();

workspaceRoutes.post("/", authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const input = parseOrThrow(createWorkspaceSchema, body);
  const ws = await createWorkspace(c.get("userId"), input);
  return c.json(success(ws, "Workspace created successfully"), 201);
});

workspaceRoutes.get("/", authMiddleware, async (c) => {
  return c.json(success(await listWorkspaces(c.get("userId"))), 200);
});

workspaceRoutes.get("/:id", authMiddleware, async (c) => {
  const ws = await getWorkspace(needParam(c, "id"), c.get("userId"));
  return c.json(success(ws), 200);
});

workspaceRoutes.put("/:id", authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const input = parseOrThrow(updateWorkspaceSchema, body);
  const ws = await updateWorkspace(needParam(c, "id"), c.get("userId"), input);
  return c.json(success(ws), 200);
});

workspaceRoutes.put("/:id/status", authMiddleware, async (c) => {
  const status = workspaceStatusSchema.safeParse(c.req.query("status"));
  if (!status.success) {
    throw new BadRequestException("Invalid status. Expected DRAFT, ACTIVE, or ARCHIVED");
  }
  const ws = await updateWorkspaceStatus(
    needParam(c, "id"),
    c.get("userId"),
    status.data,
  );
  return c.json(success(ws), 200);
});

workspaceRoutes.delete("/:id", authMiddleware, async (c) => {
  await deleteWorkspace(needParam(c, "id"), c.get("userId"));
  return c.json(success(null, "Workspace deleted successfully"), 200);
});

workspaceRoutes.get("/:id/members", authMiddleware, async (c) => {
  return c.json(
    success(await listWorkspaceMembers(needParam(c, "id"), c.get("userId"))),
    200,
  );
});

workspaceRoutes.post("/:id/members", authMiddleware, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const input = parseOrThrow(addMemberSchema, body);
  await addWorkspaceMember(needParam(c, "id"), c.get("userId"), input);
  return c.json(success(null, "Member added successfully"), 201);
});

workspaceRoutes.put("/:id/members/:userId", authMiddleware, async (c) => {
  const role = memberRoleSchema.safeParse(c.req.query("role"));
  if (!role.success) {
    throw new BadRequestException("Invalid role. Expected ADMIN, ANNOTATOR, or CURATOR");
  }
  await changeMemberRole(
    needParam(c, "id"),
    c.get("userId"),
    needParam(c, "userId"),
    role.data,
  );
  return c.json(success(null, "Member role updated successfully"), 200);
});

workspaceRoutes.delete("/:id/members/:userId", authMiddleware, async (c) => {
  await removeWorkspaceMember(
    needParam(c, "id"),
    c.get("userId"),
    needParam(c, "userId"),
  );
  return c.json(success(null, "Member removed successfully"), 200);
});
