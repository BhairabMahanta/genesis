import { randomUUID } from "node:crypto";
import { verifyAccessToken } from "../lib/jwt.js";

/**
 * Minimal SockJS + STOMP broker for live notifications. Port of the
 * `genesis-notification` WebSocket surface (`WebSocketConfig`,
 * `WebSocketAuthInterceptor`, `NotificationEventListener`) reduced to what
 * the frontend uses:
 *
 * - SockJS xhr-polling transport: `POST .../xhr` (open), `GET .../xhr`
 *   (long-poll, 20s server heartbeat), `POST .../xhr_send` (client frames).
 * - STOMP: CONNECT (JWT in `Authorization` header → user binding),
 *   SUBSCRIBE to `/user/queue/notifications`, UNSUBSCRIBE, DISCONNECT.
 * - Server push: `pushToUser()` delivers MESSAGE frames to a recipient's
 *   sessions (called from `notifyWorkspaceMembers`).
 *
 * Sessions live in memory with automatic TTL reaping for abandoned connections.
 * No SockJS websocket transport — the client falls back to xhr-polling automatically.
 */

const POLL_HOLD_MS = 20_000;
const SESSION_TTL_MS = 60_000;

interface PendingPoll {
  id: number;
  respond: (body: string) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface Session {
  id: string;
  userId: string | null;
  subscriptions: Map<string, string>; // destination -> subscription id
  queue: string[];
  pending: PendingPoll | null;
  pollSeq: number;
  alive: boolean;
  lastActiveAt: number;
}

const sessions = new Map<string, Session>();

function getOrCreateSession(id: string): Session {
  let s = sessions.get(id);
  if (!s) {
    s = {
      id,
      userId: null,
      subscriptions: new Map(),
      queue: [],
      pending: null,
      pollSeq: 0,
      alive: true,
      lastActiveAt: Date.now(),
    };
    sessions.set(id, s);
  } else {
    s.lastActiveAt = Date.now();
  }
  return s;
}

function settlePending(s: Session, body: string): void {
  const p = s.pending;
  s.pending = null;
  if (!p) return;
  clearTimeout(p.timer);
  try {
    p.respond(body);
  } catch {
    // Client already gone — drop the frames.
  }
}

function flushQueue(s: Session): void {
  if (s.queue.length === 0 || !s.pending) return;
  const frames = s.queue.splice(0, s.queue.length);
  settlePending(s, `a[${frames.map((f) => JSON.stringify(f)).join(",")}]`);
}

export function openSession(sessionId: string): boolean {
  if (sessions.has(sessionId)) return false;
  getOrCreateSession(sessionId);
  return true;
}

/** Long-poll: resolves with queued frames, or a heartbeat after 20s. */
export function pollSession(sessionId: string): Promise<string | null> {
  const s = sessions.get(sessionId);
  if (!s || !s.alive) return Promise.resolve(null);
  s.lastActiveAt = Date.now();
  if (s.queue.length > 0) {
    const frames = s.queue.splice(0, s.queue.length);
    return Promise.resolve(`a[${frames.map((f) => JSON.stringify(f)).join(",")}]`);
  }
  return new Promise((resolve) => {
    if (s.pending) settlePending(s, "h\n");
    const id = ++s.pollSeq;
    const timer = setTimeout(() => {
      if (s.pending?.id === id) settlePending(s, "h\n");
      resolve("h\n");
    }, POLL_HOLD_MS);
    s.pending = {
      id,
      respond: (body) => resolve(body),
      timer,
    };
  });
}

interface StompFrame {
  command: string;
  headers: Map<string, string>;
  body: string;
}

function parseFrames(raw: string): StompFrame[] {
  const out: StompFrame[] = [];
  for (const chunk of raw.split("\0")) {
    if (chunk === "") continue;
    const headEnd = chunk.indexOf("\n\n");
    const head = headEnd === -1 ? chunk : chunk.slice(0, headEnd);
    const body = headEnd === -1 ? "" : chunk.slice(headEnd + 2).replace(/\n$/, "");
    const lines = head.split("\n");
    const command = (lines.shift() ?? "").trim();
    const headers = new Map<string, string>();
    for (const line of lines) {
      const sep = line.indexOf(":");
      if (sep > 0) headers.set(line.slice(0, sep).trim(), line.slice(sep + 1).trim());
    }
    if (command !== "") out.push({ command, headers, body });
  }
  return out;
}

function sendError(s: Session, message: string): void {
  s.queue.push(`ERROR\nmessage:${message}\n\n\0`);
  flushQueue(s);
  closeSession(s.id);
}

async function handleConnect(s: Session, frame: StompFrame): Promise<void> {
  const auth = frame.headers.get("Authorization") ?? frame.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  if (token === "") {
    sendError(s, "Missing Authorization header");
    return;
  }
  try {
    const claims = await verifyAccessToken(token);
    s.userId = claims.userId;
    s.queue.push("CONNECTED\nversion:1.2\nheart-beat:0,0\n\n\0");
    flushQueue(s);
  } catch {
    sendError(s, "Invalid or expired token");
  }
}

function handleSubscribe(s: Session, frame: StompFrame): void {
  const destination = frame.headers.get("destination") ?? "";
  const subId = frame.headers.get("id") ?? frame.headers.get("subscription") ?? destination;
  if (destination !== "") s.subscriptions.set(destination, subId);
}

function handleUnsubscribe(s: Session, frame: StompFrame): void {
  const destination = frame.headers.get("destination") ?? "";
  const subId = frame.headers.get("id") ?? "";
  if (destination !== "") {
    s.subscriptions.delete(destination);
  } else if (subId !== "") {
    for (const [dest, id] of s.subscriptions) {
      if (id === subId) {
        s.subscriptions.delete(dest);
        break;
      }
    }
  }
}

/** Handles raw STOMP payloads posted to `.../xhr_send` (JSON string array). */
export async function receiveFromClient(sessionId: string, payload: unknown): Promise<void> {
  const s = getOrCreateSession(sessionId);
  if (!s.alive) return;
  s.lastActiveAt = Date.now();
  const chunks = Array.isArray(payload) ? payload : [payload];
  for (const chunk of chunks) {
    if (typeof chunk !== "string") continue;
    for (const frame of parseFrames(chunk)) {
      switch (frame.command) {
        case "CONNECT":
        case "STOMP":
          await handleConnect(s, frame);
          break;
        case "SUBSCRIBE":
          handleSubscribe(s, frame);
          break;
        case "UNSUBSCRIBE":
          handleUnsubscribe(s, frame);
          break;
        case "DISCONNECT":
          closeSession(s.id);
          break;
        default:
          break;
      }
      if (!s.alive) return;
    }
  }
}

/** Server push: MESSAGE frame to every live session of the recipient. */
export function pushToUser(userId: string, destination: string, body: unknown): void {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  for (const s of sessions.values()) {
    if (!s.alive || s.userId !== userId) continue;
    const sub = s.subscriptions.get(destination);
    if (!sub) continue;
    s.lastActiveAt = Date.now();
    s.queue.push(
      `MESSAGE\nsubscription:${sub}\nmessage-id:${randomUUID()}\ndestination:${destination}\ncontent-type:application/json\n\n${text}\0`,
    );
    flushQueue(s);
  }
}

export function closeSession(sessionId: string): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  s.alive = false;
  if (s.pending) settlePending(s, `c[3000,"Go away!"]`);
  sessions.delete(sessionId);
}

/** Reaps sessions that have been abandoned without active long-polling. */
export function reapAbandonedSessions(): number {
  const now = Date.now();
  let reaped = 0;
  for (const [id, s] of sessions.entries()) {
    if (!s.alive || (!s.pending && now - s.lastActiveAt > SESSION_TTL_MS)) {
      closeSession(id);
      reaped++;
    }
  }
  return reaped;
}

const reaperTimer = setInterval(reapAbandonedSessions, 30_000);
if (typeof reaperTimer.unref === "function") {
  reaperTimer.unref();
}
