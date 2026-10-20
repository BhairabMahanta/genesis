import { BadRequestException, NotFoundException } from "../common/errors.js";
import {
  appendLog,
  BUILTIN_POS_TAGS,
  deletePosByTokenAndAnnotator,
  deletePosTag,
  findDocumentById,
  findPosTagById,
  findPosTagDefinition,
  findTokenById,
  listPosByDocument,
  listPosByToken,
  listPosTags,
  listTokens,
  savePosTag,
  upsertPosAnnotation,
} from "../store/prisma.js";
import { requireMember } from "./workspace.service.js";
import type {
  CreatePosTagInput,
  PosAnnotationDto,
  PosTagDefinitionDto,
} from "../schemas/pos.schemas.js";

const TAG_PATTERN = /^[A-Z][A-Z0-9_]{0,19}$/;

function validationError(field: string, message: string): BadRequestException {
  return new BadRequestException("Validation failed", { [field]: [message] });
}

function normalizeTag(value: string): string {
  return value.trim().toUpperCase();
}

function toDto(a: {
  id: string;
  tokenId: string;
  annotatorId: string;
  posTag: string;
  updatedAt: string;
}): PosAnnotationDto {
  return {
    id: a.id,
    tokenId: a.tokenId,
    annotatorId: a.annotatorId,
    posTag: a.posTag,
    timestamp: a.updatedAt,
  };
}

export async function listTags(workspaceId?: string): Promise<PosTagDefinitionDto[]> {
  const builtins: PosTagDefinitionDto[] = BUILTIN_POS_TAGS.map((t) => ({
    id: null,
    tag: t.tag,
    description: t.description,
    scope: "GLOBAL",
    workspaceId: null,
    builtin: true,
  }));
  const customRows = await listPosTags(workspaceId);
  const customs: PosTagDefinitionDto[] = customRows.map((t) => ({
    id: t.id,
    tag: t.tag,
    description: t.description,
    scope: t.scope,
    workspaceId: t.workspaceId,
    builtin: false,
  }));
  return [...builtins, ...customs];
}

export async function createTag(
  userId: string,
  input: CreatePosTagInput,
): Promise<PosTagDefinitionDto> {
  const tag = normalizeTag(input.tag);
  if (!TAG_PATTERN.test(tag)) {
    throw validationError(
      "tag",
      "Tag must start with an uppercase letter and contain only A-Z, 0-9, underscore (max 20 chars)",
    );
  }
  if (BUILTIN_POS_TAGS.some((builtin) => builtin.tag === tag)) {
    throw validationError("tag", `Tag conflicts with a built-in universal tag: ${tag}`);
  }

  const scope = input.scope;
  let workspaceId: string | null = null;
  if (scope === "WORKSPACE") {
    if (!input.workspaceId) {
      throw validationError("workspaceId", "workspaceId is required when scope=WORKSPACE");
    }
    await requireMember(input.workspaceId, userId);
    workspaceId = input.workspaceId;
  }

  if (await findPosTagDefinition(tag, scope, workspaceId)) {
    throw validationError(
      "tag",
      scope === "GLOBAL"
        ? `Global tag already exists: ${tag}`
        : `Tag already exists in this workspace: ${tag}`,
    );
  }

  const row = await savePosTag({
    tag,
    description: input.description ?? null,
    scope,
    workspaceId,
    builtin: false,
  });
  return {
    id: row.id,
    tag: row.tag,
    description: row.description,
    scope: row.scope,
    workspaceId: row.workspaceId,
    builtin: false,
  };
}

export async function removeTag(id: string): Promise<void> {
  if (!(await findPosTagById(id))) {
    throw new NotFoundException("POS tag definition not found");
  }
  await deletePosTag(id);
}

async function tokenWorkspace(
  tokenId: string,
): Promise<{ workspaceId: string; documentId: string }> {
  const token = await findTokenById(tokenId);
  if (!token) throw new NotFoundException("Token not found");
  const doc = await findDocumentById(token.documentId);
  if (!doc) throw new NotFoundException("Document not found");
  return { workspaceId: doc.workspaceId, documentId: doc.id };
}

async function effectiveTags(workspaceId: string): Promise<Set<string>> {
  const custom = await listPosTags(workspaceId);
  return new Set([
    ...BUILTIN_POS_TAGS.map((tag) => tag.tag),
    ...custom.map((tag) => tag.tag),
  ]);
}

async function validatePosTag(workspaceId: string, value: string): Promise<string> {
  const posTag = normalizeTag(value);
  if (!posTag) {
    throw validationError("pos", "pos is required");
  }
  if (!(await effectiveTags(workspaceId)).has(posTag)) {
    throw validationError("pos", `Invalid POS tag: ${posTag}`);
  }
  return posTag;
}

export async function updateTokenPos(
  tokenId: string,
  userId: string,
  pos: string | null,
): Promise<PosAnnotationDto | null> {
  const { workspaceId, documentId } = await tokenWorkspace(tokenId);
  await requireMember(workspaceId, userId);
  if (pos == null) {
    await deletePosByTokenAndAnnotator(tokenId, userId);
    return null;
  }
  const posTag = await validatePosTag(workspaceId, pos);
  const row = await upsertPosAnnotation({
    tokenId,
    documentId,
    annotatorId: userId,
    posTag,
  });
  await appendLog({
    workspaceId,
    userId,
    actionType: "POS_TAGGED",
    entityId: tokenId,
    payloadJson: JSON.stringify({ posTag, documentId }),
  });
  return toDto(row);
}

export async function batchUpdate(
  userId: string,
  updates: Array<{ tokenId: string; pos: string | null }>,
): Promise<PosAnnotationDto[]> {
  const out: PosAnnotationDto[] = [];
  for (const update of updates) {
    const dto = await updateTokenPos(update.tokenId, userId, update.pos);
    if (dto) out.push(dto);
  }
  return out;
}

export async function getByToken(
  tokenId: string,
  userId: string,
): Promise<PosAnnotationDto[]> {
  const { workspaceId } = await tokenWorkspace(tokenId);
  await requireMember(workspaceId, userId);
  return (await listPosByToken(tokenId)).map(toDto);
}

export async function getByDocument(
  documentId: string,
  userId: string,
): Promise<PosAnnotationDto[]> {
  const doc = await findDocumentById(documentId);
  if (!doc) throw new NotFoundException("Document not found");
  await requireMember(doc.workspaceId, userId);
  return (await listPosByDocument(documentId)).map(toDto);
}

/** Membership-free majority (mirrors `getMajorityPosByDocumentInternal`). */
export async function majorityByDocumentInternal(
  documentId: string,
): Promise<Record<string, string>> {
  const annotations = (await listPosByDocument(documentId)).map(toDto);
  const byToken = new Map<string, Map<string, number>>();
  for (const annotation of annotations) {
    let votes = byToken.get(annotation.tokenId);
    if (!votes) {
      votes = new Map();
      byToken.set(annotation.tokenId, votes);
    }
    votes.set(annotation.posTag, (votes.get(annotation.posTag) ?? 0) + 1);
  }
  const out: Record<string, string> = {};
  for (const [tokenId, votes] of byToken) {
    const sorted = [...votes.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    const winner = sorted[0]?.[0];
    if (winner) out[tokenId] = winner;
  }
  // Fill untagged tokens from stored token rows so export has full coverage.
  for (const token of await listTokens(documentId)) {
    if (!out[token.id] && token.pos) out[token.id] = token.pos;
  }
  return out;
}

export async function majorityByDocument(
  documentId: string,
  userId: string,
): Promise<Record<string, string>> {
  const doc = await findDocumentById(documentId);
  if (!doc) throw new NotFoundException("Document not found");
  await requireMember(doc.workspaceId, userId);
  return majorityByDocumentInternal(documentId);
}
