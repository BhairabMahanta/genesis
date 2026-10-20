import { bodyLimit } from "hono/body-limit";
import { logger } from "hono/logger";
import { Hono } from "hono";
import { config } from "./config.js";
import { isDatabaseHealthy } from "./db.js";
import { success } from "./common/response.js";
import { corsMiddleware } from "./middleware/cors.js";
import { errorHandler, notFoundHandler } from "./middleware/errors.js";
import { authRoutes } from "./routes/auth.routes.js";
import { documentRoutes } from "./routes/document.routes.js";
import { workspaceRoutes } from "./routes/workspace.routes.js";
import { nerAnnotationRoutes, nerTagRoutes } from "./routes/ner.routes.js";
import { corefRoutes } from "./routes/coref.routes.js";
import { posAnnotationRoutes, posTagRoutes } from "./routes/pos.routes.js";
import { wsdRoutes } from "./routes/wsd.routes.js";
import { editorRoutes } from "./routes/editor.routes.js";
import { notificationRoutes } from "./routes/notification.routes.js";
import { recommendationRoutes } from "./routes/recommendation.routes.js";
import { exportRoutes, shareExportRoutes } from "./routes/export.routes.js";
import { logRoutes } from "./routes/logging.routes.js";
import { wsRoutes } from "./routes/ws.routes.js";

/**
 * Genesis TypeScript API. Hono app serving the same API paths as the legacy
 * Spring backend so the frontend (`apps/web`) works unchanged.
 *
 * Layout:
 * - `routes/`      — every HTTP endpoint, one file per domain (thin:
 *                     validate → service → respond). Start here to see the API.
 * - `services/`    — business logic, one file per domain (+ `tokenizer/`,
 *                     `storage/` building blocks). No HTTP here.
 * - `schemas/`     — Zod request validation + response DTO types.
 * - `middleware/`  — auth (JWT), CORS, global error handler.
 * - `common/`      — ApiResponse envelope, HTTP errors, cursor pagination.
 * - `store/`       — Prisma persistence layer (PostgreSQL only).
 * - `lib/`         — JWT signing/verification, password hashing.
 *
 * `index.ts` owns the listener; keeping the app construction here lets tests
 * call `app.request()` without opening a port.
 */

export const app = new Hono();

// Development request log: method, path, status, and duration. The dev
// launcher sets API_REQUEST_LOGS=true; production defaults to off unless
// explicitly enabled.
const requestLogs = process.env["API_REQUEST_LOGS"];
if (
  requestLogs === "true" ||
  (requestLogs === undefined && process.env.NODE_ENV !== "production")
) {
  app.use("*", logger());
}

app.use("*", corsMiddleware);
app.use(
  "*",
  bodyLimit({
    maxSize: config.maxUploadBytes,
    onError: (c) => c.json({ success: false, message: "File exceeds the 50MB upload limit" }, 413),
  }),
);

app.get("/api/health", async (c) => {
  const database = await isDatabaseHealthy();
  return c.json(
    {
      status: database ? "UP" : "DOWN",
      checks: { database },
    },
    database ? 200 : 503,
  );
});

app.route("/api/auth", authRoutes);
app.route("/api/workspaces", workspaceRoutes);
app.route("/api", documentRoutes);
app.route("/api", corefRoutes);
app.route("/api", posAnnotationRoutes);
app.route("/api", editorRoutes);
app.route("/api", exportRoutes);
app.route("/api", recommendationRoutes);
app.route("/api", logRoutes);
app.route("/api/ner-tags", nerTagRoutes);
app.route("/api/ner-annotations", nerAnnotationRoutes);
app.route("/api/pos-tags", posTagRoutes);
app.route("/api/notifications", notificationRoutes);
app.route("/api", wsdRoutes);
app.route("/api", shareExportRoutes);
app.route("/ws", wsRoutes);

app.get("/api/version", (c) => {
  return c.json(
    success({ service: "genesis-api", phase: "phase-6", timestamp: new Date().toISOString() }),
    200,
  );
});

app.notFound(notFoundHandler);
app.onError(errorHandler);

export default app;
