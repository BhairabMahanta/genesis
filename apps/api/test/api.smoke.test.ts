import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Minimal integration smoke suite.
 *
 * Runs the real Hono app against the configured PostgreSQL database via
 * `app.request()` — no listener, no HTTP client. Unique users/workspaces keep
 * it safe to run against a development database; every row is removed again in
 * `finally`.
 *
 * Requires the Flyway V1–V8 schema and `DATABASE_URL` (defaults to the local
 * development database below).
 */

const storageBase = await mkdtemp(path.join(tmpdir(), "genesis-api-test-"));
process.env["DATABASE_URL"] ??=
  "postgresql://postgres:postgres@localhost:5432/genesis";
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
  fieldErrors?: Record<string, string[]>;
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("API smoke: auth, workspace, document, notifications, cascade delete", async (t) => {
  const ownerName = `smoke_${runId}`;
  const otherName = `smoke_other_${runId}`;
  let ownerId = "";
  let otherId = "";
  let ownerToken = "";
  let workspaceId = "";
  let documentId = "";
  let firstTokenId = "";
  let secondTokenId = "";
  const createdNerTagIds: string[] = [];
  const createdPosTagIds: string[] = [];

  try {
    await t.test("health reports database UP", async () => {
      const { res, body } = await call<{ status: string; checks: { database: boolean } }>(
        "/api/health",
      );
      assert.equal(res.status, 200);
      assert.equal(body.status, "UP");
      assert.equal(body.checks.database, true);
    });

    await t.test("protected routes reject anonymous requests", async () => {
      const { res } = await call("/api/workspaces");
      assert.equal(res.status, 401);
    });

    await t.test("signup, login, and me", async () => {
      const signup = await call<{ id: string; username: string }>(
        "/api/auth/signup",
        jsonBody({
          username: ownerName,
          email: `${ownerName}@example.com`,
          password,
          firstName: "Smoke",
          lastName: "Owner",
        }),
      );
      assert.equal(signup.res.status, 201);
      ownerId = signup.body.data.id;
      assert.equal(signup.body.data.username, ownerName);

      const login = await call<{ accessToken: string; refreshToken: string }>(
        "/api/auth/login",
        jsonBody({ usernameOrEmail: ownerName, password }),
      );
      assert.equal(login.res.status, 200);
      ownerToken = login.body.data.accessToken;
      assert.ok(login.body.data.refreshToken.length > 20);

      const me = await call<{ id: string; username: string }>(
        "/api/auth/me",
        {},
        ownerToken,
      );
      assert.equal(me.res.status, 200);
      assert.equal(me.body.data.id, ownerId);

      const other = await call<{ id: string }>(
        "/api/auth/signup",
        jsonBody({
          username: otherName,
          email: `${otherName}@example.com`,
          password,
          firstName: "Smoke",
          lastName: "Other",
        }),
      );
      assert.equal(other.res.status, 201);
      otherId = other.body.data.id;
    });

    await t.test("workspace create/get/list", async () => {
      const created = await call<{ id: string; name: string; ownerId: string }>(
        "/api/workspaces",
        jsonBody({
          name: `Smoke Workspace ${runId}`,
          description: "integration test",
          annotationType: "NER",
        }),
        ownerToken,
      );
      assert.equal(created.res.status, 201);
      workspaceId = created.body.data.id;
      assert.equal(created.body.data.ownerId, ownerId);

      const fetched = await call<{ name: string }>(
        `/api/workspaces/${workspaceId}`,
        {},
        ownerToken,
      );
      assert.equal(fetched.res.status, 200);
      assert.equal(fetched.body.data.name, `Smoke Workspace ${runId}`);

      const listed = await call<Array<{ id: string }>>(
        "/api/workspaces",
        {},
        ownerToken,
      );
      assert.equal(listed.res.status, 200);
      assert.ok(listed.body.data.some((workspace) => workspace.id === workspaceId));
    });

    await t.test("upload tokenizes into sentences and tokens", async () => {
      const form = new FormData();
      form.append(
        "file",
        new File(["John loves Mary.\nHe runs fast."], "api-smoke.txt", {
          type: "text/plain",
        }),
      );
      const uploaded = await call<{ id: string; name: string }>(
        `/api/workspaces/${workspaceId}/documents`,
        { method: "POST", body: form },
        ownerToken,
      );
      assert.equal(uploaded.res.status, 201);
      documentId = uploaded.body.data.id;
      assert.equal(uploaded.body.data.name, "api-smoke.txt");

      let completed = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const listed = await call<Array<{ id: string; processingStatus: string }>>(
          `/api/workspaces/${workspaceId}/documents`,
          {},
          ownerToken,
        );
        const doc = listed.body.data.find((row) => row.id === documentId);
        if (doc?.processingStatus === "COMPLETED") {
          completed = true;
          break;
        }
        await delay(50);
      }
      assert.ok(completed, "document tokenization did not complete");

      const content = await call<{
        tokens: Array<{ id: string; form: string }>;
        totalTokens: number;
      }>(
        `/api/editor/workspaces/${workspaceId}/documents/${documentId}/content?page=0&size=50`,
        {},
        ownerToken,
      );
      assert.equal(content.res.status, 200);
      const forms = content.body.data.tokens.map((token) => token.form);
      assert.ok(forms.includes("John"));
      assert.ok(forms.includes("loves"));
      assert.ok(forms.includes("Mary"));
      assert.ok(content.body.data.totalTokens >= 6);
      firstTokenId = content.body.data.tokens[0]?.id ?? "";
      secondTokenId = content.body.data.tokens[1]?.id ?? "";
      assert.ok(firstTokenId && secondTokenId, "expected token ids for annotation tests");
    });

    await t.test("NER annotations reject undefined labels and invalid spans", async () => {
      const created = await call<{
        id: string;
        label: string;
        startTokenIndex: number;
        endTokenIndex: number;
      }>(
        "/api/ner-annotations",
        jsonBody({ documentId, startTokenIndex: 0, endTokenIndex: 1, label: "PERSON" }),
        ownerToken,
      );
      assert.equal(created.res.status, 200);
      assert.equal(created.body.data.label, "PERSON");
      const annotationId = created.body.data.id;

      const badLabel = await call(
        "/api/ner-annotations",
        jsonBody({
          documentId,
          startTokenIndex: 0,
          endTokenIndex: 1,
          label: "SMOKE_UNDEFINED",
        }),
        ownerToken,
      );
      assert.equal(badLabel.res.status, 400);
      assert.ok(badLabel.body.fieldErrors?.["label"]);

      const badBounds = await call(
        "/api/ner-annotations",
        jsonBody({
          documentId,
          startTokenIndex: 0,
          endTokenIndex: 99999,
          label: "PERSON",
        }),
        ownerToken,
      );
      assert.equal(badBounds.res.status, 400);
      assert.ok(badBounds.body.fieldErrors?.["endTokenIndex"]);

      const reversedUpdate = await call(
        `/api/ner-annotations/${annotationId}`,
        jsonBody({ startTokenIndex: 2, endTokenIndex: 1 }, "PATCH"),
        ownerToken,
      );
      assert.equal(reversedUpdate.res.status, 400);
      assert.ok(reversedUpdate.body.fieldErrors?.["endTokenIndex"]);

      const outOfBoundsUpdate = await call(
        `/api/ner-annotations/${annotationId}`,
        jsonBody({ endTokenIndex: 99999 }, "PATCH"),
        ownerToken,
      );
      assert.equal(outOfBoundsUpdate.res.status, 400);
      assert.ok(outOfBoundsUpdate.body.fieldErrors?.["endTokenIndex"]);

      const badUpdateLabel = await call(
        `/api/ner-annotations/${annotationId}`,
        jsonBody({ label: "SMOKE_UNDEFINED" }, "PATCH"),
        ownerToken,
      );
      assert.equal(badUpdateLabel.res.status, 400);
      assert.ok(badUpdateLabel.body.fieldErrors?.["label"]);

      const validUpdate = await call<{ label: string; startTokenIndex: number; endTokenIndex: number }>(
        `/api/ner-annotations/${annotationId}`,
        jsonBody({ startTokenIndex: 1, endTokenIndex: 2, label: "ORG" }, "PATCH"),
        ownerToken,
      );
      assert.equal(validUpdate.res.status, 200);
      assert.equal(validUpdate.body.data.label, "ORG");
      assert.equal(validUpdate.body.data.startTokenIndex, 1);
      assert.equal(validUpdate.body.data.endTokenIndex, 2);

      const customTag = `SMK_${runId.toUpperCase()}`;
      const createdTag = await call<{ id: string; tag: string; scope: string }>(
        "/api/ner-tags",
        jsonBody({
          tag: customTag,
          description: "smoke custom NER tag",
          scope: "WORKSPACE",
          workspaceId,
        }),
        ownerToken,
      );
      assert.equal(createdTag.res.status, 200);
      assert.equal(createdTag.body.data.tag, customTag);
      assert.equal(createdTag.body.data.scope, "WORKSPACE");
      createdNerTagIds.push(createdTag.body.data.id);

      const customAnnotation = await call<{ label: string }>(
        "/api/ner-annotations",
        jsonBody({
          documentId,
          startTokenIndex: 0,
          endTokenIndex: 1,
          label: customTag,
        }),
        ownerToken,
      );
      assert.equal(customAnnotation.res.status, 200);
      assert.equal(customAnnotation.body.data.label, customTag);

      const duplicateTag = await call(
        "/api/ner-tags",
        jsonBody({ tag: customTag, scope: "WORKSPACE", workspaceId }),
        ownerToken,
      );
      assert.equal(duplicateTag.res.status, 400);
      assert.ok(duplicateTag.body.fieldErrors?.["tag"]);

      const builtinConflict = await call(
        "/api/ner-tags",
        jsonBody({ tag: "PERSON", scope: "WORKSPACE", workspaceId }),
        ownerToken,
      );
      assert.equal(builtinConflict.res.status, 400);
      assert.ok(builtinConflict.body.fieldErrors?.["tag"]);

      const invalidPattern = await call(
        "/api/ner-tags",
        jsonBody({ tag: "bad-tag", scope: "WORKSPACE", workspaceId }),
        ownerToken,
      );
      assert.equal(invalidPattern.res.status, 400);
      assert.ok(invalidPattern.body.fieldErrors?.["tag"]);
    });

    await t.test("POS annotations require defined tags", async () => {
      const valid = await call<{ posTag: string }>(
        `/api/tokens/${firstTokenId}/pos`,
        jsonBody({ pos: "NOUN" }, "PUT"),
        ownerToken,
      );
      assert.equal(valid.res.status, 200);
      assert.equal(valid.body.data.posTag, "NOUN");

      const invalid = await call(
        `/api/tokens/${firstTokenId}/pos`,
        jsonBody({ pos: "SMOKE_UNDEFINED" }, "PUT"),
        ownerToken,
      );
      assert.equal(invalid.res.status, 400);
      assert.ok(invalid.body.fieldErrors?.["pos"]);

      const invalidBatch = await call(
        "/api/tokens/pos/batch",
        jsonBody(
          { updates: [{ tokenId: secondTokenId, pos: "SMOKE_UNDEFINED" }] },
          "PUT",
        ),
        ownerToken,
      );
      assert.equal(invalidBatch.res.status, 400);
      assert.ok(invalidBatch.body.fieldErrors?.["pos"]);

      const validBatch = await call<Array<{ posTag: string; tokenId: string }>>(
        "/api/tokens/pos/batch",
        jsonBody(
          {
            updates: [
              { tokenId: secondTokenId, pos: "VERB" },
              { tokenId: firstTokenId, pos: null },
            ],
          },
          "PUT",
        ),
        ownerToken,
      );
      assert.equal(validBatch.res.status, 200);
      assert.equal(validBatch.body.data.length, 1);
      assert.equal(validBatch.body.data[0]?.posTag, "VERB");
      assert.equal(validBatch.body.data[0]?.tokenId, secondTokenId);

      const customTag = `PSMK_${runId.toUpperCase()}`;
      const createdTag = await call<{ id: string; tag: string; scope: string }>(
        "/api/pos-tags",
        jsonBody({
          tag: customTag,
          description: "smoke custom POS tag",
          scope: "WORKSPACE",
          workspaceId,
        }),
        ownerToken,
      );
      assert.equal(createdTag.res.status, 200);
      assert.equal(createdTag.body.data.tag, customTag);
      createdPosTagIds.push(createdTag.body.data.id);

      const customAnnotation = await call<{ posTag: string }>(
        `/api/tokens/${secondTokenId}/pos`,
        jsonBody({ pos: customTag }, "PUT"),
        ownerToken,
      );
      assert.equal(customAnnotation.res.status, 200);
      assert.equal(customAnnotation.body.data.posTag, customTag);

      const duplicateTag = await call(
        "/api/pos-tags",
        jsonBody({ tag: customTag, scope: "WORKSPACE", workspaceId }),
        ownerToken,
      );
      assert.equal(duplicateTag.res.status, 400);
      assert.ok(duplicateTag.body.fieldErrors?.["tag"]);

      const builtinConflict = await call(
        "/api/pos-tags",
        jsonBody({ tag: "NOUN", scope: "WORKSPACE", workspaceId }),
        ownerToken,
      );
      assert.equal(builtinConflict.res.status, 400);
      assert.ok(builtinConflict.body.fieldErrors?.["tag"]);
    });

    await t.test("notifications are scoped to their owner", async () => {
      const otherLogin = await call<{ accessToken: string }>(
        "/api/auth/login",
        jsonBody({ usernameOrEmail: otherName, password }),
      );
      const otherToken = otherLogin.body.data.accessToken;

      let notifications: Array<{ id: string; title: string }> = [];
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const listed = await call<Array<{ id: string; title: string }>>(
          "/api/notifications",
          {},
          ownerToken,
        );
        notifications = listed.body.data;
        const titles = notifications.map((notification) => notification.title);
        if (
          titles.includes("Workspace Created") &&
          titles.includes("Document Uploaded") &&
          titles.includes("Document Processing Complete")
        ) {
          break;
        }
        await delay(50);
      }
      const titles = notifications.map((notification) => notification.title);
      assert.ok(titles.includes("Workspace Created"));
      assert.ok(titles.includes("Document Uploaded"));
      assert.ok(titles.includes("Document Processing Complete"));

      const target = notifications[0];
      assert.ok(target, "expected at least one notification");

      const otherList = await call<Array<{ id: string }>>(
        "/api/notifications",
        {},
        otherToken,
      );
      assert.equal(otherList.res.status, 200);
      assert.ok(!otherList.body.data.some((n) => n.id === target.id));

      const crossRead = await call(`/api/notifications/${target.id}/read`, { method: "PUT" }, otherToken);
      assert.equal(crossRead.res.status, 404);

      const crossDelete = await call(`/api/notifications/${target.id}`, { method: "DELETE" }, otherToken);
      assert.equal(crossDelete.res.status, 404);

      const read = await call(`/api/notifications/${target.id}/read`, { method: "PUT" }, ownerToken);
      assert.equal(read.res.status, 200);

      const removed = await call(`/api/notifications/${target.id}`, { method: "DELETE" }, ownerToken);
      assert.equal(removed.res.status, 200);
    });

    await t.test("workspace delete cascades documents", async () => {
      const documentRow = await prisma.document.findUnique({
        where: { id: documentId },
        select: { storedFileId: true },
      });
      assert.ok(documentRow?.storedFileId, "expected the document to reference a stored file");

      const deleted = await call(`/api/workspaces/${workspaceId}`, { method: "DELETE" }, ownerToken);
      assert.equal(deleted.res.status, 200);

      const workspace = await call(`/api/workspaces/${workspaceId}`, {}, ownerToken);
      assert.ok(
        [401, 404].includes(workspace.res.status),
        `expected the deleted workspace to be inaccessible, got ${workspace.res.status}`,
      );

      const document = await prisma.document.findUnique({ where: { id: documentId } });
      assert.equal(document, null);
      const stored = await prisma.storedFile.findUnique({
        where: { id: documentRow.storedFileId },
      });
      assert.equal(stored, null);
      workspaceId = "";
      documentId = "";
    });
  } finally {
    if (workspaceId && ownerToken) {
      await call(`/api/workspaces/${workspaceId}`, { method: "DELETE" }, ownerToken).catch(() => undefined);
    }
    if (createdNerTagIds.length > 0) {
      await prisma.ner_tag_definitions
        .deleteMany({ where: { id: { in: createdNerTagIds } } })
        .catch(() => undefined);
    }
    if (createdPosTagIds.length > 0) {
      await prisma.pos_tag_definitions
        .deleteMany({ where: { id: { in: createdPosTagIds } } })
        .catch(() => undefined);
    }
    const userIds = [ownerId, otherId].filter(Boolean);
    if (userIds.length > 0) {
      await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.workspaceMember.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
    await rm(storageBase, { recursive: true, force: true });
  }
});
