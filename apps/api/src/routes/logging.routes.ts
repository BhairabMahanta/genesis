import { Hono } from "hono";
import { success } from "../common/response.js";
import { needParam } from "../common/params.js";
import { authMiddleware } from "../middleware/auth.js";
import { getLogs } from "../services/annotation-log.service.js";

export const logRoutes = new Hono();

logRoutes.get("/workspaces/:workspaceId/logs", authMiddleware, async (c) => {
  const page = Number(c.req.query("page") ?? 0);
  const size = Number(c.req.query("size") ?? 50);
  const actionType = c.req.query("action_type") ?? c.req.query("actionType") ?? undefined;
  const from = c.req.query("from") ?? undefined;
  const to = c.req.query("to") ?? undefined;
  return c.json(
    success(
      await getLogs(needParam(c, "workspaceId"), c.get("userId"), {
        page: Number.isFinite(page) ? Math.max(0, Math.trunc(page)) : 0,
        size: Number.isFinite(size) ? Math.trunc(size) : 50,
        actionType,
        from,
        to,
      }),
    ),
    200,
  );
});
