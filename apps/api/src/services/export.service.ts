import { SignJWT } from "jose";
import { NotFoundException } from "../common/errors.js";
import { config } from "../config.js";
import {
  findDocumentById,
  findWorkspaceById,
  listDocumentsByWorkspace,
  listPosByDocument,
  listSentences,
  listTokens,
} from "../store/prisma.js";
import type { TokenEntity } from "../store/types.js";
import { requireMember } from "./workspace.service.js";
import { majorityByDocument } from "./pos.service.js";
import {
  corefAnnotationsForDocument,
  exportDocumentText,
  exportMergedText,
  sanitizeFilename,
  type DocumentExportData,
  type ExportColumnOptions,
} from "./conll-exporter.js";
import { createZip } from "./zip.js";
import type { ExportOptions } from "../schemas/export.schemas.js";

export interface ExportResult {
  filename: string;
  contentType: string;
  content: string | Uint8Array;
}

interface ResolvedOptions extends ExportColumnOptions {
  exportFormat: "MERGED_SINGLE_FILE" | "SEPARATE_FILES_ZIP" | "SEPARATE_FILES_ZIP_WITH_MERGED";
}

/** Java `ExportOptions` defaults: PART_NUMBER / SEPARATE_FILES_ZIP / continue / part 0. */
function resolveOptions(input: ExportOptions): ResolvedOptions {
  return {
    column2Mode: input.column2Mode ?? "PART_NUMBER",
    exportFormat: input.exportFormat ?? "SEPARATE_FILES_ZIP",
    continueSentenceNumbers: input.continueSentenceNumbers ?? true,
    defaultPartNumber: input.defaultPartNumber ?? 0,
  };
}

async function tokensBySentence(documentId: string): Promise<Map<number, TokenEntity[]>> {
  const map = new Map<number, TokenEntity[]>();
  for (const token of await listTokens(documentId)) {
    const list = map.get(token.sentenceIndex) ?? [];
    list.push(token);
    map.set(token.sentenceIndex, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.tokenIndex - b.tokenIndex);
  return map;
}

async function docExportData(
  documentId: string,
  documentName: string,
  userId: string,
): Promise<DocumentExportData> {
  return {
    documentName,
    sentences: await listSentences(documentId),
    tokensBySentence: await tokensBySentence(documentId),
    corefAnnotations: await corefAnnotationsForDocument(documentId),
    posOverrides: new Map(Object.entries(await majorityByDocument(documentId, userId))),
  };
}

/** Distinct annotator count per token (consensus-confidence sidecar). */
async function annotatorCounts(documentId: string): Promise<Map<string, number>> {
  const byToken = new Map<string, Set<string>>();
  for (const annotation of await listPosByDocument(documentId)) {
    let set = byToken.get(annotation.tokenId);
    if (!set) {
      set = new Set();
      byToken.set(annotation.tokenId, set);
    }
    set.add(annotation.annotatorId);
  }
  return new Map([...byToken.entries()].map(([tokenId, set]) => [tokenId, set.size]));
}

export async function exportDocument(
  documentId: string,
  userId: string,
  rawOptions: ExportOptions,
): Promise<ExportResult> {
  const doc = await findDocumentById(documentId);
  if (!doc) throw new NotFoundException("Document not found");
  await requireMember(doc.workspaceId, userId);
  const options = resolveOptions(rawOptions);
  const data = await docExportData(documentId, doc.name, userId);
  const content = exportDocumentText(
    data.documentName,
    data.sentences,
    data.tokensBySentence,
    data.corefAnnotations,
    data.posOverrides,
    options,
    0,
  );
  return {
    filename: `${sanitizeFilename(doc.name)}.conll`,
    contentType: "text/plain; charset=UTF-8",
    content,
  };
}

export async function exportWorkspace(
  workspaceId: string,
  userId: string,
  rawOptions: ExportOptions,
): Promise<ExportResult> {
  const ws = await findWorkspaceById(workspaceId);
  if (!ws) throw new NotFoundException("Workspace not found");
  await requireMember(workspaceId, userId);
  const options = resolveOptions(rawOptions);
  const docs = await listDocumentsByWorkspace(workspaceId);

  if (docs.length === 0) {
    return { filename: `${ws.name}.conll`, contentType: "text/plain", content: "" };
  }

  if (options.exportFormat === "MERGED_SINGLE_FILE") {
    const data: DocumentExportData[] = [];
    for (const doc of docs) {
      data.push(await docExportData(doc.id, doc.name, userId));
    }
    return {
      filename: `${sanitizeFilename(ws.name)}.conll`,
      contentType: "text/plain; charset=UTF-8",
      content: exportMergedText(data, options),
    };
  }

  // ZIP export (default): one .conll per document (+ merged + sidecar as requested).
  const encoder = new TextEncoder();
  const usedFilenames = new Map<string, number>();
  const entries: Array<{ name: string; data: Uint8Array }> = [];
  let sentenceOffset = 0;
  const datas: DocumentExportData[] = [];
  for (const doc of docs) {
    const data = await docExportData(doc.id, doc.name, userId);
    datas.push(data);
    const content = exportDocumentText(
      data.documentName,
      data.sentences,
      data.tokensBySentence,
      data.corefAnnotations,
      data.posOverrides,
      options,
      options.continueSentenceNumbers ? sentenceOffset : 0,
    );
    const base = sanitizeFilename(doc.name);
    const seen = usedFilenames.get(base) ?? 0;
    usedFilenames.set(base, seen + 1);
    const entryName = seen === 0 ? `${base}.conll` : `${base}_${seen + 1}.conll`;
    entries.push({ name: entryName, data: encoder.encode(content) });
    if (options.continueSentenceNumbers) sentenceOffset += data.sentences.length;
  }

  if (options.exportFormat === "SEPARATE_FILES_ZIP_WITH_MERGED") {
    entries.push({
      name: "merged.conll",
      data: encoder.encode(exportMergedText(datas, options)),
    });
  }

  // Sidecar CSV with annotator counts (consensus confidence).
  const csv: string[] = ["document_id,token_id,annotator_count"];
  let anyRow = false;
  for (const doc of docs) {
    for (const [tokenId, count] of await annotatorCounts(doc.id)) {
      csv.push(`${doc.id},${tokenId},${count}`);
      anyRow = true;
    }
  }
  if (anyRow) {
    entries.push({
      name: `${sanitizeFilename(ws.name)}_annotators.csv`,
      data: encoder.encode(csv.join("\n")),
    });
  }

  return {
    filename: `${sanitizeFilename(ws.name)}.zip`,
    contentType: "application/zip",
    content: createZip(entries),
  };
}

export async function issueShareToken(
  workspaceId: string,
  userId: string,
): Promise<{ token: string; expiresInSeconds: number }> {
  const ws = await findWorkspaceById(workspaceId);
  if (!ws) throw new NotFoundException("Workspace not found");
  await requireMember(workspaceId, userId);
  const expiresInSeconds = 24 * 60 * 60;
  const token = await new SignJWT({ workspace_id: workspaceId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
    .sign(new TextEncoder().encode(config.jwtSecret));
  return { token, expiresInSeconds };
}
