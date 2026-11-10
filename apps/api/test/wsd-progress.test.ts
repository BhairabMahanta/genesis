import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * WSD progress: stays correct when the dictionary changes, and keeps working at
 * Hemkosh scale (a workspace with far more headwords than one SQL statement can
 * take as bind parameters). Needs the V1-V9 schema and DATABASE_URL.
 */

const storageBase = await mkdtemp(path.join(tmpdir(), "genesis-wsd-progress-"));
process.env["DATABASE_URL"] ??= "postgresql://postgres:postgres@localhost:5432/genesis";
process.env["JWT_SECRET"] ??= "test-only-secret-that-is-at-least-32-chars";
process.env["STORAGE_PROVIDER"] = "local";
process.env["STORAGE_LOCAL_BASE_PATH"] = storageBase;
process.env["API_REQUEST_LOGS"] = "false";

const { default: app } = await import("../src/app.js");
const { prisma } = await import("../src/db.js");

const runId = randomUUID().slice(0, 8);
const password = "password123";

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

async function call<T>(
  pathname: string,
  init: RequestInit = {},
  token?: string,
): Promise<{ res: Response; body: ApiResponse<T> }> {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await app.request(pathname, { ...init, headers });
  const text = await res.text();
  return { res, body: (text ? JSON.parse(text) : {}) as ApiResponse<T> };
}

const json = (value: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(value),
});

test("WSD progress follows dictionary changes and survives a huge dictionary", async (t) => {
  const username = `wsd_prog_${runId}`;
  let userId = "";
  let token = "";
  let workspaceId = "";

  try {
    const signup = await call<{ id: string }>(
      "/api/auth/signup",
      json({ username, email: `${username}@example.com`, password, firstName: "Prog", lastName: "Test" }),
    );
    assert.equal(signup.res.status, 201);
    userId = signup.body.data.id;
    token = (
      await call<{ accessToken: string }>("/api/auth/login", json({ usernameOrEmail: username, password }))
    ).body.data.accessToken;

    const ws = await call<{ id: string }>(
      "/api/workspaces",
      json({ name: `WSD progress ${runId}`, annotationType: "WSD" }),
      token,
    );
    workspaceId = ws.body.data.id;
    const base = `/api/workspaces/${workspaceId}`;

    // "কাল" once and "ভাত" twice. The text has three candidate tokens in total.
    const form = new FormData();
    form.append("file", new File(["কাল আমি ভাত খালোঁ। ভাত ভাল আছিল।"], "progress.txt", { type: "text/plain" }));
    const uploaded = await call<{ id: string }>(`${base}/documents`, { method: "POST", body: form }, token);
    const documentId = uploaded.body.data.id;
    for (let i = 0; i < 100; i += 1) {
      const docs = await call<Array<{ id: string; processingStatus: string }>>(`${base}/documents`, {}, token);
      if (docs.body.data.find((d) => d.id === documentId)?.processingStatus === "COMPLETED") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const content = await call<{ tokens: Array<{ id: string; form: string }> }>(
      `/api/editor/workspaces/${workspaceId}/documents/${documentId}/content?page=0&size=50`,
      {},
      token,
    );
    const kalToken = content.body.data.tokens.find((tok) => tok.form === "কাল")!;

    const snapshot = async () => {
      const w = (await call<{ progressPercentage: number }>(base, {}, token)).body.data;
      const d = (await call<Array<{ id: string; progress: number | null }>>(`${base}/documents`, {}, token)).body.data.find(
        (x) => x.id === documentId,
      )!;
      return { workspace: w.progressPercentage, document: d.progress };
    };

    await t.test("tagging the only listed word gives 100%", async () => {
      await call(`${base}/wsd/import`, json({ entries: [{ word: "কাল", senseLabel: "সময়" }] }), token);
      const senses = await call<Array<{ id: string }>>(`${base}/wsd/senses?word=${encodeURIComponent("কাল")}`, {}, token);
      const annotated = await call(`${base}/wsd/annotations`, json({ tokenId: kalToken.id, senseId: senses.body.data[0]!.id }), token);
      assert.equal(annotated.res.status, 200);
      assert.deepEqual(await snapshot(), { workspace: 100, document: 1 });
    });

    await t.test("importing more ambiguous words re-bases document and workspace progress", async () => {
      // Simulate a document last computed before this import: stale, too-high value.
      const imported = await call<{ inserted: number }>(
        `${base}/wsd/import`,
        json({ entries: [{ word: "ভাত", senseLabel: "অন্ন" }] }),
        token,
      );
      assert.equal(imported.body.data.inserted, 1);
      const after = await snapshot();
      // 1 tagged of 3 ambiguous occurrences (কাল x1 + ভাত x2)
      assert.equal(after.workspace, 33.3);
      assert.ok(Math.abs((after.document ?? 0) - 1 / 3) < 1e-9, `document progress was ${after.document}`);
    });

    await t.test("removing a word from the dictionary re-bases progress again", async () => {
      const senses = await call<Array<{ id: string }>>(`${base}/wsd/senses?word=${encodeURIComponent("ভাত")}`, {}, token);
      const removed = await call(`${base}/wsd/senses/${senses.body.data[0]!.id}`, { method: "DELETE" }, token);
      assert.equal(removed.res.status, 200);
      assert.deepEqual(await snapshot(), { workspace: 100, document: 1 });
    });

    await t.test("a 20,000-headword dictionary does not break the workspace endpoints", async () => {
      // Two bind parameters per word used to exceed PostgreSQL's 32,767 limit at ~16,400 words.
      for (let offset = 0; offset < 20000; offset += 5000) {
        const entries = Array.from({ length: 5000 }, (_, i) => ({ word: `শব্দ${runId}${offset + i}`, senseLabel: "অৰ্থ" }));
        const imported = await call<{ inserted: number }>(`${base}/wsd/import`, json({ entries }), token);
        assert.equal(imported.res.status, 200);
        assert.equal(imported.body.data.inserted, 5000);
      }
      const one = await call(base, {}, token);
      assert.equal(one.res.status, 200);
      const list = await call("/api/workspaces", {}, token);
      assert.equal(list.res.status, 200);
      assert.deepEqual(await snapshot(), { workspace: 100, document: 1 });
    });
  } finally {
    if (workspaceId && token) {
      await call(`/api/workspaces/${workspaceId}`, { method: "DELETE" }, token).catch(() => undefined);
    }
    if (userId) {
      await prisma.refreshToken.deleteMany({ where: { userId } });
      await prisma.workspaceMember.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    await prisma.$disconnect();
    await rm(storageBase, { recursive: true, force: true });
  }
});
