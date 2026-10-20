import { Hono } from "hono";
import { needParam } from "../common/params.js";
import {
  closeSession,
  openSession,
  pollSession,
  receiveFromClient,
} from "../services/stomp-broker.js";

/**
 * SockJS + STOMP surface for `/ws` (see `services/stomp-broker.ts`).
 * The frontend connects with SockJS + `@stomp/stompjs` in real mode and
 * subscribes to `/user/queue/notifications`.
 */
export const wsRoutes = new Hono();

const SOCKJS_CONTENT_TYPE = "application/javascript;charset=UTF-8";

wsRoutes.get("/info", (c) => {
  // This server implements SockJS xhr-polling only. Advertising native
  // websocket makes SockJS try (and log) a failed handshake before falling
  // back, so tell the client the truth.
  return c.json({
    websocket: false,
    cookie_needed: false,
    origins: ["*:*"],
    entropy: Math.floor(Math.random() * 1e9),
  });
});

// SockJS xhr-polling uses POST for both the open request and every receive
// poll. The first POST on a session id answers the open frame; later POSTs
// long-poll for queued MESSAGE/heartbeat frames.
wsRoutes.post("/:server/:session/xhr", async (c) => {
  const sessionId = needParam(c, "session");
  if (openSession(sessionId)) {
    return c.text("o\n", 200, { "Content-Type": SOCKJS_CONTENT_TYPE });
  }
  const body = await pollSession(sessionId);
  if (body === null) {
    closeSession(sessionId);
    return c.text(`c[3000,"Go away!"]\n`, 200, { "Content-Type": SOCKJS_CONTENT_TYPE });
  }
  return c.text(body.endsWith("\n") ? body : `${body}\n`, 200, {
    "Content-Type": SOCKJS_CONTENT_TYPE,
  });
});

// Long-poll: queued MESSAGE frames, or a heartbeat after ~20s.
wsRoutes.get("/:server/:session/xhr", async (c) => {
  const body = await pollSession(needParam(c, "session"));
  if (body === null) {
    closeSession(needParam(c, "session"));
    return c.text(`c[3000,"Go away!"]\n`, 200, { "Content-Type": SOCKJS_CONTENT_TYPE });
  }
  return c.text(body.endsWith("\n") ? body : `${body}\n`, 200, {
    "Content-Type": SOCKJS_CONTENT_TYPE,
  });
});

// Client frames (CONNECT / SUBSCRIBE / UNSUBSCRIBE / DISCONNECT).
wsRoutes.post("/:server/:session/xhr_send", async (c) => {
  const payload = await c.req.json().catch(() => []);
  await receiveFromClient(needParam(c, "session"), payload);
  return c.body(null, 204);
});

// No native-WS transport — SockJS falls back to xhr-polling automatically.
wsRoutes.get("/:server/:session/websocket", (c) => {
  return c.text("websocket transport not supported; use xhr polling", 400);
});
