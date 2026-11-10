import path from "node:path";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "../common/errors.js";
import {
  appendLog,
  countWsdAnnotationsBySense,
  createWsdSenses,
  deleteWsdAnnotation,
  deleteWsdSense,
  findDocumentById,
  findMember,
  findTokenById,
  findWsdAnnotation,
  findWsdSense,
  findWsdSenseByWordAndLabel,
  listWsdAnnotationDetails,
  listWsdAnnotationsForDocument,
  listWsdAnnotationsForToken,
  listWsdByWorkspace,
  listWsdSenses,
  saveWsdAnnotation,
  saveWsdSense,
  updateWsdSense,
} from "../store/prisma.js";
import type { MultipartFile } from "../common/multipart.js";
import { onWsdAnnotationChanged } from "./document.service.js";
import { requireAdmin, requireMember } from "./workspace.service.js";
import type {
  CreateSenseInput,
  CreateSenseWithAnnotationInput,
  CreateWsdAnnotationInput,
  WsdAnnotationDto,
  WsdSenseDto,
} from "../schemas/wsd.schemas.js";
import { parseSenseWorkbook } from "./wsd-sense-import.service.js";
import type { SenseRowError } from "./wsd-sense-import.service.js";
import {
  buildAnnotationExport,
  buildSenseInventoryExport,
  parseExportFormat,
} from "./wsd-export.service.js";
import type { ExportFile, WsdExportFormat } from "./wsd-export.service.js";

export interface SenseImportSummary {
  sheetName: string;
  words: number;
  sensesInFile: number;
  created: number;
  skippedDuplicates: number;
  skippedInvalid: number;
  duplicatesInFile: number;
  errors: SenseRowError[];
}

const SENSE_IMPORT_EXTENSIONS = new Set([".xls", ".xlsx", ".xlsm", ".csv"]);
const SENSE_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
const MAX_WORD_LENGTH = 200;
const MAX_SENSE_LABEL_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;

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

/**
 * Import an ambiguous-word workbook into a workspace's sense inventory.
 * Existing `(word, senseLabel)` pairs are skipped case-insensitively, so
 * re-uploading the same file is safe.
 */
export async function importSenses(
  workspaceId: string,
  userId: string,
  file: MultipartFile,
): Promise<SenseImportSummary> {
  await requireAdmin(workspaceId, userId);

  const extension = path.extname(file.filename).toLowerCase();
  if (!SENSE_IMPORT_EXTENSIONS.has(extension)) {
    throw new BadRequestException(
      "Unsupported word-list file. Upload an .xls, .xlsx, .xlsm or .csv file.",
    );
  }
  if (file.bytes.byteLength > SENSE_IMPORT_MAX_BYTES) {
    throw new BadRequestException("Word-list file exceeds the 10MB import limit.");
  }

  const parsed = parseSenseWorkbook(file.bytes, file.filename);
  const existing = await listWsdSenses(workspaceId);
  const existingKeys = new Set(
    existing.map(
      (sense) => `${sense.word.toLowerCase()}\u0000${sense.senseLabel.toLowerCase()}`,
    ),
  );

  const toCreate: Array<{
    workspaceId: string;
    word: string;
    senseLabel: string;
    description: string | null;
  }> = [];
  let skippedDuplicates = 0;
  for (const row of parsed.rows) {
    const key = `${row.word.toLowerCase()}\u0000${row.senseLabel.toLowerCase()}`;
    if (existingKeys.has(key)) {
      skippedDuplicates += 1;
      continue;
    }
    existingKeys.add(key);
    toCreate.push({
      workspaceId,
      word: row.word,
      senseLabel: row.senseLabel,
      description: row.description,
    });
  }

  await createWsdSenses(toCreate);

  return {
    sheetName: parsed.sheetName,
    words: new Set(parsed.rows.map((row) => row.word.toLowerCase())).size,
    sensesInFile: parsed.rows.length,
    created: toCreate.length,
    skippedDuplicates,
    skippedInvalid: new Set(parsed.errors.map((error) => error.rowNumber)).size,
    duplicatesInFile: parsed.duplicatesInFile,
    errors: parsed.errors.slice(0, 25),
  };
}

export async function createSense(
  workspaceId: string,
  userId: string,
  input: CreateSenseInput,
): Promise<WsdSenseDto> {
  await requireAdmin(workspaceId, userId);
  const clash = await findWsdSenseByWordAndLabel(workspaceId, input.word, input.senseLabel);
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

/**
 * Create (or reuse) a sense for the token's word and annotate the token in one
 * call. Any workspace member can use this from the editor, which is how the
 * inventory grows from annotation work. The word is derived from the token on
 * the server, never from the client payload.
 */
export async function createSenseAndAnnotate(
  workspaceId: string,
  userId: string,
  input: CreateSenseWithAnnotationInput,
): Promise<{ sense: WsdSenseDto; annotation: WsdAnnotationDto }> {
  await requireMember(workspaceId, userId);

  const token = await findTokenById(input.tokenId);
  if (!token) throw new NotFoundException("Token not found");
  const document = await findDocumentById(token.documentId);
  if (!document || document.workspaceId !== workspaceId) {
    throw new NotFoundException("Token not found in this workspace");
  }

  const word = token.form.trim();
  if (!word) throw new BadRequestException("Cannot create a sense for an empty token");
  if (word.length > MAX_WORD_LENGTH) {
    throw new BadRequestException(`Word exceeds ${MAX_WORD_LENGTH} characters`);
  }

  const senseLabel = input.senseLabel.trim();
  if (!senseLabel) throw new BadRequestException("Sense label is required");
  if (senseLabel.length > MAX_SENSE_LABEL_LENGTH) {
    throw new BadRequestException(
      `Sense label exceeds ${MAX_SENSE_LABEL_LENGTH} characters`,
    );
  }
  const description = input.description?.trim() || null;
  if (description && description.length > MAX_DESCRIPTION_LENGTH) {
    throw new BadRequestException(
      `Sense description exceeds ${MAX_DESCRIPTION_LENGTH} characters`,
    );
  }

  let sense = await findWsdSenseByWordAndLabel(workspaceId, word, senseLabel);
  if (!sense) {
    sense = await saveWsdSense({
      workspaceId,
      word,
      senseLabel,
      description,
    });
  }

  const row = await saveWsdAnnotation({
    workspaceId,
    tokenId: token.id,
    documentId: token.documentId,
    senseId: sense.id,
    annotatorId: userId,
  });
  await onWsdAnnotationChanged(token.documentId);

  await appendLog({
    workspaceId,
    userId,
    actionType: "WSD_ANNOTATED",
    entityId: row.id,
    payloadJson: JSON.stringify({ tokenId: row.tokenId, senseId: row.senseId }),
  });

  return {
    sense: toSenseDto(sense),
    annotation: {
      id: row.id,
      tokenId: row.tokenId,
      senseId: row.senseId,
      senseLabel: sense.senseLabel,
      annotatorId: row.annotatorId,
      workspaceId: row.workspaceId,
      timestamp: row.createdAt,
    },
  };
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
  await requireAdmin(workspaceId, userId);
  const row = await findWsdSense(senseId);
  if (!row || row.workspaceId !== workspaceId) throw new NotFoundException("Sense not found");
  const inUse = await countWsdAnnotationsBySense(senseId);
  if (inUse > 0) {
    throw new ConflictException(`This sense is used by ${inUse} annotations`);
  }
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

/** Full workspace sense inventory as CSV (flat) or XLSX (template shape). */
export async function exportSenseInventory(
  workspaceId: string,
  userId: string,
  format: string,
): Promise<ExportFile> {
  await requireMember(workspaceId, userId);
  const senses = await listWsdSenses(workspaceId);
  const parsedFormat: WsdExportFormat = parseExportFormat(format);
  return buildSenseInventoryExport(
    senses.map((sense) => ({
      word: sense.word,
      senseLabel: sense.senseLabel,
      description: sense.description,
    })),
    parsedFormat,
    workspaceId,
  );
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
      senseDescription: detail.senseDescription,
      annotatorId: detail.annotatorId,
      annotatorName: detail.annotatorName,
      timestamp: detail.timestamp,
    })),
    parsedFormat,
    workspaceId,
  );
}
