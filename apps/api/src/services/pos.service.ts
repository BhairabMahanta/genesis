import { NotFoundException } from "../common/errors.js";
import {
  appendLog,
  BUILTIN_POS_TAGS,
  deletePosByTokenAndAnnotator,
  deletePosTag,
  findDocumentById,
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

export async function createTag(input: CreatePosTagInput): Promise<PosTagDefinitionDto> {
  const row = await savePosTag({
    tag: input.tag.toUpperCase(),
    description: input.description ?? null,
    scope: input.scope,
    workspaceId: input.workspaceId ?? null,
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
  const row = await upsertPosAnnotation({
    tokenId,
    documentId,
    annotatorId: userId,
    posTag: pos.toUpperCase(),
  });
  await appendLog({
    workspaceId,
    userId,
    actionType: "POS_TAGGED",
    entityId: row.id,
    payloadJson: JSON.stringify({ tokenId, pos }),
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
