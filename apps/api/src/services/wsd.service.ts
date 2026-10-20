import { BadRequestException, NotFoundException } from "../common/errors.js";
import {
  appendLog,
  deleteWsdAnnotation,
  deleteWsdSense,
  findDocumentById,
  findTokenById,
  findWsdAnnotation,
  findWsdSense,
  listWsdByDocument,
  listWsdByToken,
  listWsdByWorkspace,
  listWsdSenses,
  saveWsdAnnotation,
  saveWsdSense,
  updateWsdSense,
} from "../store/prisma.js";
import { requireMember } from "./workspace.service.js";
import type {
  CreateSenseInput,
  CreateWsdAnnotationInput,
  WsdAnnotationDto,
  WsdSenseDto,
} from "../schemas/wsd.schemas.js";

function toSenseDto(s: {
  id: string;
  workspaceId: string;
  word: string;
  senseLabel: string;
  description: string | null;
}): WsdSenseDto {
  return s;
}

async function toAnnotationDto(a: {
  id: string;
  tokenId: string;
  senseId: string;
  annotatorId: string;
  workspaceId: string;
  createdAt: string;
}): Promise<WsdAnnotationDto> {
  const sense = await findWsdSense(a.senseId);
  return {
    id: a.id,
    tokenId: a.tokenId,
    senseId: a.senseId,
    senseLabel: sense?.senseLabel ?? null,
    annotatorId: a.annotatorId,
    workspaceId: a.workspaceId,
    timestamp: a.createdAt,
  };
}

export async function listSenses(
  workspaceId: string,
  userId: string,
  word?: string,
): Promise<WsdSenseDto[]> {
  await requireMember(workspaceId, userId);
  return (await listWsdSenses(workspaceId, word)).map(toSenseDto);
}

export async function createSense(
  workspaceId: string,
  userId: string,
  input: CreateSenseInput,
): Promise<WsdSenseDto> {
  await requireMember(workspaceId, userId);
  const clash = (await listWsdSenses(workspaceId)).some(
    (s) =>
      s.word.toLowerCase() === input.word.toLowerCase() &&
      s.senseLabel.toLowerCase() === input.senseLabel.toLowerCase(),
  );
  if (clash) throw new BadRequestException("A sense with this word and label already exists");
  return toSenseDto(
    await saveWsdSense({
      workspaceId,
      word: input.word,
      senseLabel: input.senseLabel,
      description: input.description ?? null,
    }),
  );
}

export async function updateSense(
  workspaceId: string,
  userId: string,
  senseId: string,
  input: CreateSenseInput,
): Promise<WsdSenseDto> {
  await requireMember(workspaceId, userId);
  const row = await findWsdSense(senseId);
  if (!row || row.workspaceId !== workspaceId) throw new NotFoundException("Sense not found");
  const updated = await updateWsdSense(senseId, {
    word: input.word,
    senseLabel: input.senseLabel,
    description: input.description ?? null,
  });
  if (!updated) throw new NotFoundException("Sense not found");
  return toSenseDto(updated);
}

export async function removeSense(
  workspaceId: string,
  userId: string,
  senseId: string,
): Promise<void> {
  await requireMember(workspaceId, userId);
  const row = await findWsdSense(senseId);
  if (!row || row.workspaceId !== workspaceId) throw new NotFoundException("Sense not found");
  await deleteWsdSense(senseId);
}

export async function annotate(
  workspaceId: string,
  userId: string,
  input: CreateWsdAnnotationInput,
): Promise<WsdAnnotationDto> {
  await requireMember(workspaceId, userId);
  const sense = await findWsdSense(input.senseId);
  if (!sense || sense.workspaceId !== workspaceId) throw new NotFoundException("Sense not found");
  const token = await findTokenById(input.tokenId);
  if (!token) throw new NotFoundException("Token not found");
  const doc = await findDocumentById(token.documentId);
  if (!doc) throw new NotFoundException("Document not found");
  const row = await saveWsdAnnotation({
    workspaceId,
    tokenId: input.tokenId,
    documentId: input.documentId ?? doc.id,
    senseId: input.senseId,
    annotatorId: userId,
  });
  await appendLog({
    workspaceId,
    userId,
    actionType: "WSD_ANNOTATED",
    entityId: row.id,
    payloadJson: JSON.stringify({ tokenId: row.tokenId, senseId: row.senseId }),
  });
  return toAnnotationDto(row);
}

export async function annotationsForToken(
  workspaceId: string,
  userId: string,
  tokenId: string,
): Promise<WsdAnnotationDto[]> {
  await requireMember(workspaceId, userId);
  const rows = (await listWsdByToken(tokenId)).filter((a) => a.workspaceId === workspaceId);
  return Promise.all(rows.map(toAnnotationDto));
}

export async function annotationsForDocument(
  workspaceId: string,
  userId: string,
  documentId: string,
): Promise<WsdAnnotationDto[]> {
  await requireMember(workspaceId, userId);
  const doc = await findDocumentById(documentId);
  if (!doc) throw new NotFoundException("Document not found");
  // Include token-bound annotations even when documentId was null at write time.
  const direct = await listWsdByDocument(workspaceId, documentId);
  const byTokenDoc = await listWsdTokenScan(workspaceId, documentId);
  const seen = new Set(direct.map((d) => d.id));
  const directDtos = await Promise.all(direct.map(toAnnotationDto));
  const scanDtos = await Promise.all(
    byTokenDoc.filter((d) => !seen.has(d.id)).map(toAnnotationDto),
  );
  return [...directDtos, ...scanDtos];
}

async function listWsdTokenScan(
  workspaceId: string,
  documentId: string,
): Promise<Awaited<ReturnType<typeof listWsdByWorkspace>>> {
  // Scan annotations whose token belongs to this document (covers legacy null
  // documentId writes from before V8).
  const out = [];
  for (const annotation of await listWsdByWorkspace(workspaceId)) {
    if (annotation.workspaceId !== workspaceId) continue;
    const token = await findTokenById(annotation.tokenId);
    if (token && token.documentId === documentId) out.push(annotation);
  }
  return out;
}

export async function removeAnnotation(
  workspaceId: string,
  userId: string,
  annotationId: string,
): Promise<void> {
  await requireMember(workspaceId, userId);
  const row = await findWsdAnnotation(annotationId);
  if (!row || row.workspaceId !== workspaceId) {
    throw new NotFoundException("Annotation not found");
  }
  await deleteWsdAnnotation(annotationId);
}

/** Replace tab/newline in TSV cells so the output stays parseable. */
function tsvCell(value: unknown): string {
  if (value == null) return "";
  return String(value).replace(/\t/g, " ").replace(/\n/g, " ").replace(/\r/g, " ");
}

/** Port of `WsdExportService.exportPerAnnotator`: one row per annotation. */
export async function exportPerAnnotator(
  workspaceId: string,
  userId: string,
): Promise<string> {
  await requireMember(workspaceId, userId);
  const lines = ["token_id\tword\tsense_label\tannotator_id"];
  for (const annotation of await listWsdByWorkspace(workspaceId)) {
    const sense = await findWsdSense(annotation.senseId);
    const token = await findTokenById(annotation.tokenId);
    lines.push(
      [
        annotation.tokenId,
        tsvCell(token?.form),
        tsvCell(sense?.senseLabel),
        tsvCell(annotation.annotatorId),
      ].join("\t"),
    );
  }
  return lines.join("\n");
}

/** Port of `WsdExportService.exportConsensus`: majority sense per token. */
export async function exportConsensus(
  workspaceId: string,
  userId: string,
): Promise<string> {
  await requireMember(workspaceId, userId);
  const groups = new Map<string, Map<string, { votes: number; latest: string }>>();
  for (const annotation of await listWsdByWorkspace(workspaceId)) {
    let group = groups.get(annotation.tokenId);
    if (!group) {
      group = new Map();
      groups.set(annotation.tokenId, group);
    }
    const entry = group.get(annotation.senseId) ?? { votes: 0, latest: "" };
    entry.votes += 1;
    if (annotation.createdAt > entry.latest) entry.latest = annotation.createdAt;
    group.set(annotation.senseId, entry);
  }
  const lines = ["token_id\tword\tsense_label\tvotes"];
  for (const [tokenId, group] of groups) {
    const winner = [...group.entries()].sort(
      (x, y) => y[1].votes - x[1].votes || y[1].latest.localeCompare(x[1].latest),
    )[0];
    if (!winner) continue;
    const sense = await findWsdSense(winner[0]);
    const token = await findTokenById(tokenId);
    lines.push(
      [
        tokenId,
        tsvCell(token?.form),
        tsvCell(sense?.senseLabel),
        String(winner[1].votes),
      ].join("\t"),
    );
  }
  return lines.join("\n");
}
