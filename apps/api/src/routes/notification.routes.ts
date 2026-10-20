import { Hono } from "hono";
import { success } from "../common/response.js";
import { needParam } from "../common/params.js";
import { authMiddleware } from "../middleware/auth.js";
import { listForUser, markAllRead, markRead, remove } from "../services/notification.service.js";

/**
 * `/api/notifications` routes. The legacy Java controller uses PUT for
 * read/read-all; BACKEND_MIGRATION.md lists POST. The frontend gateway
 * uses PUT. Both verbs are accepted here so either client works.
 */
export const notificationRoutes = new Hono();

notificationRoutes.get("/", authMiddleware, async (c) => {
  return c.json(success(await listForUser(c.get("userId"))), 200);
});

notificationRoutes.put("/:id/read", authMiddleware, async (c) => {
  await markRead(c.get("userId"), needParam(c, "id"));
  return c.json(success(null, "Notification marked as read"), 200);
});

notificationRoutes.post("/:id/read", authMiddleware, async (c) => {
  await markRead(c.get("userId"), needParam(c, "id"));
  return c.json(success(null, "Notification marked as read"), 200);
});

notificationRoutes.put("/read-all", authMiddleware, async (c) => {
  await markAllRead(c.get("userId"));
  return c.json(success(null, "All notifications marked as read"), 200);
});

notificationRoutes.post("/read-all", authMiddleware, async (c) => {
  await markAllRead(c.get("userId"));
  return c.json(success(null, "All notifications marked as read"), 200);
});

notificationRoutes.delete("/:id", authMiddleware, async (c) => {
  await remove(c.get("userId"), needParam(c, "id"));
  return c.json(success(null, "Notification deleted"), 200);
});
