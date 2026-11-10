import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * WSD editor workflow: ambiguous-word matching, member-level sense creation,
 * and document annotations carrying the token word. Needs the Flyway V1–V8
 * schema and DATABASE_URL, like api.smoke.test.ts; removes its own rows.
 */

const storageBase = await mkdtemp(path.join(tmpdir(), "genesis-wsd-test-"));
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
  message?: string;
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

function jsonBody(value: unknown, method = "POST"): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  };
}

async function signup(username: string): Promise<{ id: string; token: string }> {
  const created = await call<{ id: string }>(
    "/api/auth/signup",
    jsonBody({
      username,
      email: `${username}@example.com`,
      password,
      firstName: "Wsd",
      lastName: "Tester",
    }),
  );
  assert.equal(created.res.status, 201);
  const login = await call<{ accessToken: string }>(
    "/api/auth/login",
    jsonBody({ usernameOrEmail: username, password }),
  );
  assert.equal(login.res.status, 200);
  return { id: created.body.data.id, token: login.body.data.accessToken };
}

test("WSD editor: ambiguous-word match, annotator sense creation, token word on annotations", async (t) => {
  const adminName = `wsd_admin_${runId}`;
  const annotatorName = `wsd_annot_${runId}`;
  let adminId = "";
  let annotatorId = "";
  let workspaceId = "";

  try {
    const admin = await signup(adminName);
    adminId = admin.id;
    const annotator = await signup(annotatorName);
    annotatorId = annotator.id;

    const ws = await call<{ id: string }>(
      "/api/workspaces",
      jsonBody({ name: `WSD editor ${runId}`, annotationType: "WSD" }),
      admin.token,
    );
    assert.equal(ws.res.status, 201);
    workspaceId = ws.body.data.id;
    const base = `/api/workspaces/${workspaceId}`;

    const member = await call(
      `${base}/members`,
      jsonBody({ email: `${annotatorName}@example.com`, role: "ANNOTATOR" }),
      admin.token,
    );
    assert.equal(member.res.status, 201);

    // Assamese document: কাল (time/tomorrow) and মুখ (face/mouth) are ambiguous.
    const form = new FormData();
    form.append(
      "file",
      new File(["মানুহজনে বহু কাল ধৰি বাস কৰি আছে। তেওঁ মুখ ধুই ভাত খালে।"], "asm.txt", {
        type: "text/plain",
      }),
    );
    const uploaded = await call<{ id: string }>(`${base}/documents`, { method: "POST", body: form }, admin.token);
    assert.equal(uploaded.res.status, 201);
    const documentId = uploaded.body.data.id;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const listed = await call<Array<{ id: string; processingStatus: string }>>(`${base}/documents`, {}, admin.token);
      if (listed.body.data.find((d) => d.id === documentId)?.processingStatus === "COMPLETED") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const content = await call<{ tokens: Array<{ id: string; form: string; sentenceIndex: number }> }>(
      `/api/editor/workspaces/${workspaceId}/documents/${documentId}/content?page=0&size=50`,
      {},
      admin.token,
    );
    const tokens = content.body.data.tokens;
    const kalToken = tokens.find((tok) => tok.form === "কাল");
    const mukhToken = tokens.find((tok) => tok.form === "মুখ");
    assert.ok(kalToken && mukhToken, "Assamese words must survive tokenization intact");

    await t.test("admin imports the ambiguous-word list", async () => {
      const entries = [
        { word: "কাল", senseLabel: "সময়/যুগ", gloss: "সময়", examples: "বহু কাল ধৰি" },
        { word: "কাল", sense_label: "কাইলৈ", description: "ইয়াৰ পিছৰ দিন" },
        { word: "মুখ", senseLabel: "মুখমণ্ডল", description: "মুখ" },
      ];
      const imported = await call<{ inserted: number }>(
        `${base}/wsd/import`,
        jsonBody({ entries }),
        admin.token,
      );
      assert.equal(imported.res.status, 200);
      assert.equal(imported.body.data.inserted, 3);
    });

    await t.test("match returns only listed words with sense counts", async () => {
      const matched = await call<Array<{ word: string; senseCount: number }>>(
        `${base}/wsd/words/match`,
        jsonBody({ forms: tokens.map((tok) => tok.form) }),
        annotator.token,
      );
      assert.equal(matched.res.status, 200);
      const byWord = new Map(matched.body.data.map((m) => [m.word, m.senseCount]));
      assert.equal(byWord.get("কাল"), 2);
      assert.equal(byWord.get("মুখ"), 1);
      assert.equal(byWord.has("ধৰি"), false);
    });

    await t.test("annotator can register a new ambiguous word but not edit or import", async () => {
      const created = await call<{ id: string; word: string }>(
        `${base}/wsd/senses`,
        jsonBody({ word: "ধৰি", senseLabel: "ধৰা", gloss: "হাতেৰে ধৰা", examples: "হাত ধৰি" }),
        annotator.token,
      );
      assert.equal(created.res.status, 200);

      const duplicate = await call(
        `${base}/wsd/senses`,
        jsonBody({ word: "ধৰি", senseLabel: "ধৰা" }),
        annotator.token,
      );
      assert.equal(duplicate.res.status, 400);

      const edit = await call(
        `${base}/wsd/senses/${created.body.data.id}`,
        jsonBody({ word: "ধৰি", senseLabel: "ধৰা২" }, "PUT"),
        annotator.token,
      );
      assert.equal(edit.res.status, 403);

      const bulk = await call(`${base}/wsd/import`, jsonBody({ entries: [{ word: "x", senseLabel: "y" }] }), annotator.token);
      assert.equal(bulk.res.status, 403);

      const rematched = await call<Array<{ word: string }>>(
        `${base}/wsd/words/match`,
        jsonBody({ forms: ["ধৰি"] }),
        annotator.token,
      );
      assert.deepEqual(rematched.body.data.map((m) => m.word), ["ধৰি"]);
    });

    await t.test("confirmed sense shows up with token word and sentence", async () => {
      const mukhSenses = await call<Array<{ id: string }>>(
        `${base}/wsd/senses?word=${encodeURIComponent("মুখ")}`,
        {},
        annotator.token,
      );
      const senseId = mukhSenses.body.data[0]?.id;
      assert.ok(senseId);
      const annotated = await call(
        `${base}/wsd/annotations`,
        jsonBody({ tokenId: mukhToken.id, senseId }),
        annotator.token,
      );
      assert.equal(annotated.res.status, 200);

      const docAnnotations = await call<Array<{ tokenForm: string | null; sentenceIndex: number | null; senseLabel: string | null }>>(
        `${base}/wsd/documents/${documentId}/annotations`,
        {},
        annotator.token,
      );
      assert.equal(docAnnotations.res.status, 200);
      assert.equal(docAnnotations.body.data.length, 1);
      assert.equal(docAnnotations.body.data[0]!.tokenForm, "মুখ");
      assert.equal(docAnnotations.body.data[0]!.sentenceIndex, mukhToken.sentenceIndex);
      assert.equal(docAnnotations.body.data[0]!.senseLabel, "মুখমণ্ডল");
    });
    await t.test("gloss and examples are stored as separate fields", async () => {
      const kal = await call<Array<{ senseLabel: string; gloss: string | null; examples: string | null }>>(
        `${base}/wsd/senses?word=${encodeURIComponent("কাল")}`,
        {},
        annotator.token,
      );
      const byLabel = new Map(kal.body.data.map((x) => [x.senseLabel, x]));
      assert.equal(byLabel.get("সময়/যুগ")?.gloss, "সময়");
      assert.equal(byLabel.get("সময়/যুগ")?.examples, "বহু কাল ধৰি");
      assert.equal(byLabel.get("কাইলৈ")?.gloss, "ইয়াৰ পিছৰ দিন", "alias key `description` maps to gloss");
      assert.equal(byLabel.get("কাইলৈ")?.examples, null);
      const ghori = await call<Array<{ gloss: string | null; examples: string | null }>>(
        `${base}/wsd/senses?word=${encodeURIComponent("ধৰি")}`,
        {},
        annotator.token,
      );
      assert.equal(ghori.body.data[0]?.gloss, "হাতেৰে ধৰা");
      assert.equal(ghori.body.data[0]?.examples, "হাত ধৰি");
    });

    await t.test("✗ rejections persist per annotator and clear on ✓", async () => {
      const kal = await call<Array<{ id: string; senseLabel: string }>>(
        `${base}/wsd/senses?word=${encodeURIComponent("কাল")}`,
        {},
        annotator.token,
      );
      const time = kal.body.data.find((x) => x.senseLabel === "সময়/যুগ")!;
      const tomorrow = kal.body.data.find((x) => x.senseLabel === "কাইলৈ")!;
      const rejectionsOf = async (token: string) =>
        (await call<Array<{ tokenId: string; senseId: string }>>(`${base}/wsd/documents/${documentId}/rejections`, {}, token))
          .body.data;

      const rejected = await call(`${base}/wsd/rejections`, jsonBody({ tokenId: kalToken.id, senseId: tomorrow.id }), annotator.token);
      assert.equal(rejected.res.status, 200);
      const again = await call(`${base}/wsd/rejections`, jsonBody({ tokenId: kalToken.id, senseId: tomorrow.id }), annotator.token);
      assert.equal(again.res.status, 200, "rejecting twice is idempotent");
      assert.deepEqual(await rejectionsOf(annotator.token), [{ tokenId: kalToken.id, senseId: tomorrow.id }]);
      assert.deepEqual(await rejectionsOf(admin.token), [], "rejections are private to their annotator");

      const confirmed = await call(`${base}/wsd/annotations`, jsonBody({ tokenId: kalToken.id, senseId: tomorrow.id }), annotator.token);
      assert.equal(confirmed.res.status, 200);
      assert.deepEqual(await rejectionsOf(annotator.token), [], "confirming a sense clears its rejection");

      const reject2 = await call(`${base}/wsd/rejections`, jsonBody({ tokenId: kalToken.id, senseId: tomorrow.id }), annotator.token);
      assert.equal(reject2.res.status, 200);
      const mine = await call<Array<{ tokenId: string }>>(`${base}/wsd/documents/${documentId}/annotations`, {}, annotator.token);
      assert.equal(mine.body.data.some((a) => a.tokenId === kalToken.id), false, "rejecting the confirmed sense removes the ✓");

      const undone = await call(`${base}/wsd/rejections/${kalToken.id}/${tomorrow.id}`, { method: "DELETE" }, annotator.token);
      assert.equal(undone.res.status, 200);
      assert.deepEqual(await rejectionsOf(annotator.token), []);
      void time;
    });

    await t.test("dictionary export round-trips through the importer", async () => {
      const exportRes = await app.request(`${base}/wsd/senses/export?format=jsonl`, {
        headers: { Authorization: `Bearer ${annotator.token}` },
      });
      assert.equal(exportRes.status, 200);
      assert.match(exportRes.headers.get("Content-Disposition") ?? "", /attachment; filename=".*\.jsonl"/);
      const jsonl = await exportRes.text();
      const exported = jsonl.split("\n").map((l) => JSON.parse(l) as { word: string; sense_label: string; gloss?: string; examples?: string });
      assert.ok(exported.some((e) => e.word === "ধৰি" && e.gloss === "হাতেৰে ধৰা" && e.examples === "হাত ধৰি"));

      const csvRes = await app.request(`${base}/wsd/senses/export?format=csv`, {
        headers: { Authorization: `Bearer ${annotator.token}` },
      });
      const csvBytes = new Uint8Array(await csvRes.arrayBuffer());
      assert.deepEqual([...csvBytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "CSV starts with a UTF-8 BOM for Excel");
      const csv = new TextDecoder("utf-8", { ignoreBOM: true }).decode(csvBytes);
      assert.ok(csv.startsWith("\uFEFFword,sense_label,gloss,examples"), "CSV carries the header");

      // Re-import both files into a fresh workspace: every sense must come back identical.
      for (const [name, text] of [["dict.jsonl", jsonl], ["dict.csv", csv]] as const) {
        const ws2 = await call<{ id: string }>(
          "/api/workspaces",
          jsonBody({ name: `WSD roundtrip ${name} ${runId}`, annotationType: "WSD" }),
          admin.token,
        );
        const form = new FormData();
        form.append("file", new File([text], name));
        const imported = await call<{ inserted: number }>(
          `/api/workspaces/${ws2.body.data.id}/wsd/import`,
          { method: "POST", body: form },
          admin.token,
        );
        assert.equal(imported.body.data.inserted, exported.length, `${name}: every sense re-imported`);
        const back = await call<Array<{ word: string; senseLabel: string; gloss: string | null; examples: string | null }>>(
          `/api/workspaces/${ws2.body.data.id}/wsd/senses`,
          {},
          admin.token,
        );
        const key = (x: { word: string; senseLabel: string; gloss?: string | null; examples?: string | null }) =>
          [x.word, x.senseLabel, x.gloss ?? "", x.examples ?? ""].join("|");
        const originals = new Set(exported.map((e) => key({ word: e.word, senseLabel: e.sense_label, gloss: e.gloss, examples: e.examples })));
        assert.deepEqual(new Set(back.body.data.map(key)), originals, `${name}: content identical after round trip`);
        await call(`/api/workspaces/${ws2.body.data.id}`, { method: "DELETE" }, admin.token);
      }
    });
  } finally {
    if (workspaceId) {
      await call(`/api/workspaces/${workspaceId}`, { method: "DELETE" }, (await call<{ accessToken: string }>("/api/auth/login", jsonBody({ usernameOrEmail: adminName, password }))).body.data?.accessToken).catch(() => undefined);
    }
    const userIds = [adminId, annotatorId].filter(Boolean);
    if (userIds.length > 0) {
      await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.workspaceMember.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
    await rm(storageBase, { recursive: true, force: true });
  }
});
