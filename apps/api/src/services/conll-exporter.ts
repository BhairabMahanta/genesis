import {
  findCluster,
  listMentionsByDocument,
} from "../store/prisma.js";
import type { SentenceEntity, TokenEntity } from "../store/types.js";

/**
 * CoNLL-2012 exporter. Port of `Conll2012Exporter.java`.
 *
 * 12 tab-separated columns:
 * `doc_id part_or_sent token_id form pos parse lemma frameset sense speaker ne coref`
 * - Column 2 is the part number (`defaultPartNumber`) or, in
 *   `SENTENCE_NUMBER` mode, `sentenceIndex + sentenceOffset`.
 * - POS comes from per-token overrides (majority vote) with fallback to
 *   the stored token row; NER is the raw stored tag; coref markers use
 *   cluster numbers: `(N)` single-token, `(N` â€¦ `N)` multi-token,
 *   `|`-merged overlaps.
 */

export interface ExportColumnOptions {
  column2Mode: "PART_NUMBER" | "SENTENCE_NUMBER";
  continueSentenceNumbers: boolean;
  defaultPartNumber: number;
}

export interface DocumentExportData {
  documentName: string;
  sentences: SentenceEntity[];
  tokensBySentence: Map<number, TokenEntity[]>;
  corefAnnotations: Map<string, string>;
  posOverrides: Map<string, string> | null;
}

const PLACEHOLDER = "-";

function emptyToPlaceholder(value: string | null | undefined): string {
  return value == null || value === "" ? PLACEHOLDER : value;
}

export function sanitizeDocName(name: string | null): string {
  if (name == null) return "document";
  return name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function sanitizeFilename(name: string | null): string {
  if (name == null) return "export";
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.[^.]+$/, "");
}

/** Coref marker map for one document: key `${sentenceIndex}-${tokenIndex}`. */
export async function corefAnnotationsForDocument(
  documentId: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const merge = (key: string, marker: string): void => {
    const existing = out.get(key);
    out.set(key, existing ? `${existing}|${marker}` : marker);
  };
  for (const m of await listMentionsByDocument(documentId)) {
    if (m.clusterId == null) continue;
    const cluster = await findCluster(m.clusterId);
    if (!cluster) continue;
    const n = cluster.clusterNumber;
    if (m.startTokenIndex === m.endTokenIndex) {
      merge(`${m.sentenceIndex}-${m.startTokenIndex}`, `(${n})`);
    } else {
      merge(`${m.sentenceIndex}-${m.startTokenIndex}`, `(${n}`);
      merge(`${m.sentenceIndex}-${m.endTokenIndex}`, `${n})`);
    }
  }
  return out;
}

function formatTokenLine(
  docName: string,
  column2: number,
  token: TokenEntity,
  corefAnnotations: Map<string, string>,
  posOverrides: Map<string, string> | null,
): string {
  const corefKey = `${token.sentenceIndex}-${token.tokenIndex}`;
  const coref = corefAnnotations.get(corefKey) ?? "-";
  let pos: string;
  if (posOverrides != null && posOverrides.has(token.id)) {
    pos = emptyToPlaceholder(posOverrides.get(token.id));
  } else {
    pos = emptyToPlaceholder(token.pos);
  }
  return [
    docName,
    String(column2),
    String(token.tokenIndex),
    token.form,
    pos,
    "*",
    emptyToPlaceholder(token.lemma),
    PLACEHOLDER,
    PLACEHOLDER,
    PLACEHOLDER,
    emptyToPlaceholder(token.nerTag),
    coref,
  ].join("\t");
}

export function exportDocumentText(
  documentName: string,
  sentences: SentenceEntity[],
  tokensBySentence: Map<number, TokenEntity[]>,
  corefAnnotations: Map<string, string>,
  posOverrides: Map<string, string> | null,
  options: ExportColumnOptions,
  sentenceOffset: number,
): string {
  const docName = sanitizeDocName(documentName);
  const sb: string[] = [`#begin document (${docName}); part 000`];
  for (const sentence of sentences) {
    const tokens = tokensBySentence.get(sentence.sentenceIndex) ?? [];
    if (tokens.length === 0) continue;
    const column2 =
      options.column2Mode === "SENTENCE_NUMBER"
        ? sentence.sentenceIndex + sentenceOffset
        : options.defaultPartNumber;
    for (const token of tokens) {
      sb.push(formatTokenLine(docName, column2, token, corefAnnotations, posOverrides));
    }
    sb.push("");
  }
  sb.push("#end document");
  return sb.join("\n");
}

export function exportMergedText(docs: DocumentExportData[], options: ExportColumnOptions): string {
  const parts: string[] = [];
  let sentenceOffset = 0;
  for (const doc of docs) {
    parts.push(
      exportDocumentText(
        doc.documentName,
        doc.sentences,
        doc.tokensBySentence,
        doc.corefAnnotations,
        doc.posOverrides,
        options,
        options.continueSentenceNumbers ? sentenceOffset : 0,
      ),
    );
    if (options.continueSentenceNumbers && doc.sentences.length > 0) {
      sentenceOffset += doc.sentences.length;
    }
  }
  return parts.join("\n");
}
