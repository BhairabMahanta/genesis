import * as XLSX from "xlsx";
import { BadRequestException } from "../common/errors.js";

/**
 * CSV/XLSX builder for the annotated-occurrence export: one row per WSD
 * annotation, including the document, token position, sentence context,
 * sense text and annotator. CSV starts with a UTF-8 BOM so Excel opens
 * Assamese correctly.
 */

export type WsdExportFormat = "csv" | "xlsx";

export interface ExportFile {
  filename: string;
  contentType: string;
  body: Uint8Array | string;
}

export interface AnnotationExportRow {
  documentId: string;
  documentName: string;
  sentenceIndex: number;
  tokenIndex: number;
  tokenId: string;
  word: string;
  sentenceText: string;
  senseId: string;
  senseLabel: string;
  senseGloss: string | null;
  senseExamples: string | null;
  annotatorId: string;
  annotatorName: string;
  timestamp: string;
}

export function parseExportFormat(value: string | undefined): WsdExportFormat {
  const normalized = (value ?? "csv").toLowerCase();
  if (normalized !== "csv" && normalized !== "xlsx") {
    throw new BadRequestException("Unsupported export format. Use csv or xlsx.");
  }
  return normalized;
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function csv(rows: unknown[][]): string {
  // Excel needs the BOM to detect UTF-8 for Assamese.
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}

function workbookBuffer(workbook: XLSX.WorkBook): Uint8Array {
  return new Uint8Array(
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer,
  );
}

const ANNOTATION_COLUMNS = [
  "document_id",
  "document_name",
  "sentence_index",
  "token_index",
  "token_id",
  "word",
  "sentence_text",
  "sense_id",
  "sense_label",
  "sense_gloss",
  "sense_examples",
  "annotator_id",
  "annotator_name",
  "timestamp",
];

export function buildAnnotationExport(
  rows: AnnotationExportRow[],
  format: WsdExportFormat,
  workspaceId: string,
): ExportFile {
  const table: unknown[][] = [
    ANNOTATION_COLUMNS,
    ...rows.map((row) => [
      row.documentId,
      row.documentName,
      row.sentenceIndex,
      row.tokenIndex,
      row.tokenId,
      row.word,
      row.sentenceText,
      row.senseId,
      row.senseLabel,
      row.senseGloss ?? "",
      row.senseExamples ?? "",
      row.annotatorId,
      row.annotatorName,
      row.timestamp,
    ]),
  ];

  if (format === "csv") {
    return {
      filename: `wsd_annotations_${workspaceId}.csv`,
      contentType: "text/csv; charset=utf-8",
      body: csv(table),
    };
  }

  const sheet = XLSX.utils.aoa_to_sheet(table);
  sheet["!cols"] = [
    { wch: 38 },
    { wch: 28 },
    { wch: 10 },
    { wch: 10 },
    { wch: 38 },
    { wch: 20 },
    { wch: 60 },
    { wch: 38 },
    { wch: 24 },
    { wch: 32 },
    { wch: 40 },
    { wch: 38 },
    { wch: 28 },
    { wch: 26 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "WSD Annotations");
  return {
    filename: `wsd_annotations_${workspaceId}.xlsx`,
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    body: workbookBuffer(workbook),
  };
}
