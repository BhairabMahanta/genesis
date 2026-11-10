import { normalizeSenseEntry, parseSenseImportContent, type ImportSensesResult } from "./wsd-importer.service.js";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "../common/errors.js";
import {
  appendLog,
  countWsdAnnotationsBySense,
  deleteWsdAnnotation,
  deleteWsdRejection,
  deleteWsdSense,
  findDocumentById,
  findMember,
  findTokenById,
  findTokensByIds,
  findWsdAnnotation,
  findWsdSense,
  findWsdSenseByWordAndLabel,
  listDocumentsByWorkspace,
  listWsdAnnotationDetails,
  listWsdAnnotationsForDocument,
  listWsdAnnotationsForToken,
  listWsdByWorkspace,
  listWsdRejections,
  listWsdSenses,
  matchWsdWords,
  searchWsdSenses,
  bulkInsertWsdSenses,
  saveWsdAnnotation,
  saveWsdRejection,
  saveWsdSense,
  updateWsdSense,
} from "../store/prisma.js";
import { onWsdAnnotationChanged } from "./document.service.js";
import { requireAdmin, requireMember } from "./workspace.service.js";
import {
  buildAnnotationExport,
  parseExportFormat,
} from "./wsd-export.service.js";
import type { ExportFile, WsdExportFormat } from "./wsd-export.service.js";
import type {
  AmbiguousWordMatchDto,
  CreateSenseInput,
  CreateWsdAnnotationInput,
  RejectSenseInput,
  WsdAnnotationDto,
  WsdSenseDto,
} from "../schemas/wsd.schemas.js";

function toSenseDto(s: {
  id: string;
  workspaceId: string;
  word: string;
  senseLabel: string;
  gloss: string | null;
  examples: string | null;
}): WsdSenseDto {
  return {
    id: s.id,
    workspaceId: s.workspaceId,
    word: s.word,
    senseLabel: s.senseLabel,
    gloss: s.gloss,
    examples: s.examples,
  };
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


export interface PaginatedSensesDto {
  items: WsdSenseDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function searchSenses(
  workspaceId: string,
  userId: string,
  options: {
    word?: string;
    query?: string;
    page: number;
    limit: number;
  },
): Promise<PaginatedSensesDto> {
  await requireMember(workspaceId, userId);
  const skip = (options.page - 1) * options.limit;
  const take = options.limit;
  const { items, total } = await searchWsdSenses({
    workspaceId,
    word: options.word,
    query: options.query,
    skip,
    take,
  });
  return {
    items: items.map(toSenseDto),
    total,
    page: options.page,
    limit: options.limit,
    totalPages: Math.ceil(total / options.limit) || 1,
  };
}



/**
 * Document progress is stored, and its denominator is the workspace's
 * ambiguous words, so any dictionary change makes every document's value stale.
 * This also back-fills documents annotated before progress was tracked.
 */
async function refreshWorkspaceWsdProgress(workspaceId: string): Promise<void> {
  for (const doc of await listDocumentsByWorkspace(workspaceId)) {
    await onWsdAnnotationChanged(doc.id);
  }
}

export async function importSenses(
  workspaceId: string,
  userId: string,
  rawContentOrEntries: string | Uint8Array | Array<Record<string, unknown>>,
  options: { filename?: string; mode?: "skip" | "overwrite" } = {},
): Promise<ImportSensesResult> {
  await requireAdmin(workspaceId, userId);
  const entries =
    typeof rawContentOrEntries === "string" || rawContentOrEntries instanceof Uint8Array
      ? parseSenseImportContent(rawContentOrEntries, options.filename)
      : rawContentOrEntries.map(normalizeSenseEntry).filter((e) => Boolean(e.word));

  const result = await bulkInsertWsdSenses(workspaceId, entries, { mode: options.mode });
  if (result.inserted > 0 || result.updated > 0) await refreshWorkspaceWsdProgress(workspaceId);
  return result;
}


/** Which of `forms` are in the workspace's ambiguous-word list (drives editor highlighting). */
export async function matchAmbiguousWords(
  workspaceId: string,
  userId: string,
  forms: string[],
): Promise<AmbiguousWordMatchDto[]> {
  await requireMember(workspaceId, userId);
  return matchWsdWords(workspaceId, forms);
}

// Any workspace member may add a sense (annotators hit words the dictionary lacks);
// edit, delete and bulk import stay admin-only.
export async function createSense(
  workspaceId: string,
  userId: string,
  input: CreateSenseInput,
): Promise<WsdSenseDto> {
  await requireMember(workspaceId, userId);
  const clash = await findWsdSenseByWordAndLabel(workspaceId, input.word, input.senseLabel);
  if (clash) throw new BadRequestException("A sense with this word and label already exists");
  const created = toSenseDto(
    await saveWsdSense({
      workspaceId,
      word: input.word,
      senseLabel: input.senseLabel,
      gloss: input.gloss ?? null,
      examples: input.examples ?? null,
    }),
  );
  await refreshWorkspaceWsdProgress(workspaceId);
  return created;
}

export async function updateSense(
  workspaceId: string,
  userId: string,
  senseId: string,
  input: CreateSenseInput,
): Promise<WsdSenseDto> {
  await requireAdmin(workspaceId, userId);
  const row = await findWsdSense(senseId);
  if (!row || row.workspaceId !== workspaceId) throw new NotFoundException("Sense not found");
  const clash = await findWsdSenseByWordAndLabel(workspaceId, input.word, input.senseLabel);
  if (clash && clash.id !== senseId) {
    throw new BadRequestException("A sense with this word and label already exists");
  }
  const updated = await updateWsdSense(senseId, {
    word: input.word,
    senseLabel: input.senseLabel,
    gloss: input.gloss ?? null,
    examples: input.examples ?? null,
  });
  if (!updated) throw new NotFoundException("Sense not found");
  // Only a changed headword changes which tokens count as ambiguous.
  if (row.word.toLowerCase() !== input.word.toLowerCase()) {
    await refreshWorkspaceWsdProgress(workspaceId);
  }
  return toSenseDto(updated);
}

export async function removeSense(
  workspaceId: string,
  userId: string,
  senseId: string,
): Promise<void> {
  await requireAdmin(workspaceId, userId);
  const row = await findWsdSense(senseId);
  if (!row || row.workspaceId !== workspaceId) throw new NotFoundException("Sense not found");
  const inUse = await countWsdAnnotationsBySense(senseId);
  if (inUse > 0) {
    throw new ConflictException(`This sense is used by ${inUse} annotations`);
  }
  await deleteWsdSense(senseId);
  await refreshWorkspaceWsdProgress(workspaceId);
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
  if (!doc || doc.workspaceId !== workspaceId) {
    throw new NotFoundException("Token not found in this workspace");
  }
  const row = await saveWsdAnnotation({
    workspaceId,
    tokenId: input.tokenId,
    // Always use the token's document; a client-supplied id could point at a
    // different document.
    documentId: doc.id,
    senseId: input.senseId,
    annotatorId: userId,
  });
  await deleteWsdRejection(input.tokenId, input.senseId, userId);
  await onWsdAnnotationChanged(doc.id);
  await appendLog({
    workspaceId,
    userId,
    actionType: "WSD_ANNOTATED",
    entityId: row.id,
    payloadJson: JSON.stringify({ tokenId: row.tokenId, senseId: row.senseId }),
  });
  return toAnnotationDto(row);
}

/** ✗: this sense does not fit here. Persisted per annotator; also drops their ✓ on that sense. */
export async function rejectSense(
  workspaceId: string,
  userId: string,
  input: RejectSenseInput,
): Promise<void> {
  await requireMember(workspaceId, userId);
  const sense = await findWsdSense(input.senseId);
  if (!sense || sense.workspaceId !== workspaceId) throw new NotFoundException("Sense not found");
  const token = await findTokenById(input.tokenId);
  if (!token) throw new NotFoundException("Token not found");
  const doc = await findDocumentById(token.documentId);
  if (!doc) throw new NotFoundException("Document not found");
  const mine = (await listWsdAnnotationsForToken(workspaceId, input.tokenId)).find(
    (a) => a.annotatorId === userId && a.senseId === input.senseId,
  );
  if (mine) {
    await deleteWsdAnnotation(mine.id);
    await onWsdAnnotationChanged(doc.id);
  }
  await saveWsdRejection({
    workspaceId,
    documentId: doc.id,
    tokenId: input.tokenId,
    senseId: input.senseId,
    annotatorId: userId,
  });
}

export async function unrejectSense(
  workspaceId: string,
  userId: string,
  tokenId: string,
  senseId: string,
): Promise<void> {
  await requireMember(workspaceId, userId);
  await deleteWsdRejection(tokenId, senseId, userId);
}

/** The caller's own ✗ marks for a document. */
export async function rejectionsForDocument(
  workspaceId: string,
  userId: string,
  documentId: string,
): Promise<Array<{ tokenId: string; senseId: string }>> {
  await requireMember(workspaceId, userId);
  return listWsdRejections(workspaceId, documentId, userId);
}

export async function annotationsForToken(
  workspaceId: string,
  userId: string,
  tokenId: string,
): Promise<WsdAnnotationDto[]> {
  await requireMember(workspaceId, userId);
  const rows = await listWsdAnnotationsForToken(workspaceId, tokenId);
  return rows.map((r) => ({
    id: r.id,
    tokenId: r.tokenId,
    senseId: r.senseId,
    senseLabel: r.senseLabel,
    annotatorId: r.annotatorId,
    workspaceId: r.workspaceId,
    timestamp: r.createdAt,
  }));
}

export async function annotationsForDocument(
  workspaceId: string,
  userId: string,
  documentId: string,
): Promise<WsdAnnotationDto[]> {
  await requireMember(workspaceId, userId);
  const doc = await findDocumentById(documentId);
  if (!doc) throw new NotFoundException("Document not found");
  const rows = await listWsdAnnotationsForDocument(workspaceId, documentId);
  const tokens = new Map(
    (await findTokensByIds(rows.map((r) => r.tokenId))).map((t) => [t.id, t]),
  );
  return rows.map((r) => ({
    id: r.id,
    tokenId: r.tokenId,
    senseId: r.senseId,
    senseLabel: r.senseLabel,
    tokenForm: tokens.get(r.tokenId)?.form ?? null,
    sentenceIndex: tokens.get(r.tokenId)?.sentenceIndex ?? null,
    annotatorId: r.annotatorId,
    workspaceId: r.workspaceId,
    timestamp: r.createdAt,
  }));
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
  const membership = await findMember(workspaceId, userId);
  const isAdmin = membership?.role === "ADMIN";
  if (row.annotatorId !== userId && !isAdmin) {
    throw new ForbiddenException("Cannot delete another annotator's annotation");
  }
  const documentId =
    row.documentId ?? (await findTokenById(row.tokenId))?.documentId ?? null;
  await deleteWsdAnnotation(annotationId);
  if (documentId) await onWsdAnnotationChanged(documentId);
}

function csvCell(value: string | null): string {
  const v = value ?? "";
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * The workspace's sense dictionary as a file the bulk importer reads back unchanged.
 * `jsonl` is lossless; `csv` carries a UTF-8 BOM so Excel reads Assamese correctly.
 */
export async function exportSenses(
  workspaceId: string,
  userId: string,
  format: "jsonl" | "csv",
): Promise<string> {
  await requireMember(workspaceId, userId);
  const senses = await listWsdSenses(workspaceId);
  if (format === "jsonl") {
    return senses
      .map((s) =>
        JSON.stringify({
          word: s.word,
          sense_label: s.senseLabel,
          ...(s.gloss ? { gloss: s.gloss } : {}),
          ...(s.examples ? { examples: s.examples } : {}),
        }),
      )
      .join("\n");
  }
  const lines = ["word,sense_label,gloss,examples"];
  for (const s of senses) {
    lines.push([s.word, s.senseLabel, s.gloss, s.examples].map(csvCell).join(","));
  }
  return "\uFEFF" + lines.join("\r\n");
}

/**
 * One row per WSD annotation, including document, token position, sentence
 * context and sense text. This is the dataset export for downstream use.
 */
export async function exportAnnotatedOccurrences(
  workspaceId: string,
  userId: string,
  format: string,
): Promise<ExportFile> {
  await requireMember(workspaceId, userId);
  const details = await listWsdAnnotationDetails(workspaceId);
  const parsedFormat: WsdExportFormat = parseExportFormat(format);

  details.sort(
    (a, b) =>
      a.documentName.localeCompare(b.documentName) ||
      a.sentenceIndex - b.sentenceIndex ||
      a.tokenIndex - b.tokenIndex ||
      a.annotatorId.localeCompare(b.annotatorId),
  );

  return buildAnnotationExport(
    details.map((detail) => ({
      documentId: detail.documentId,
      documentName: detail.documentName,
      sentenceIndex: detail.sentenceIndex,
      tokenIndex: detail.tokenIndex,
      tokenId: detail.tokenId,
      word: detail.word,
      sentenceText: detail.sentenceText,
      senseId: detail.senseId,
      senseLabel: detail.senseLabel,
      senseGloss: detail.senseGloss,
      senseExamples: detail.senseExamples,
      annotatorId: detail.annotatorId,
      annotatorName: detail.annotatorName,
      timestamp: detail.timestamp,
    })),
    parsedFormat,
    workspaceId,
  );
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
