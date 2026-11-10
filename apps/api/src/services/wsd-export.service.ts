import * as XLSX from "xlsx";
import { BadRequestException } from "../common/errors.js";

/**
 * CSV/XLSX builders for the two WSD exports:
 *
 * - sense inventory, in the original template shape (XLSX) or a flat table (CSV)
 * - annotated occurrences, one row per annotation
 *
 * CSV output starts with a UTF-8 BOM so Excel opens Assamese text correctly.
 */

export type WsdExportFormat = "csv" | "xlsx";

export interface ExportFile {
  filename: string;
  contentType: string;
  body: Uint8Array | string;
}

export interface SenseInventoryRow {
  word: string;
  senseLabel: string;
  description: string | null;
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
  senseDescription: string | null;
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

function groupSenses(rows: SenseInventoryRow[]): Array<{
  word: string;
  senses: SenseInventoryRow[];
}> {
  const groups = new Map<string, SenseInventoryRow[]>();
  for (const row of rows) {
    const key = row.word;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  return [...groups.entries()]
    .map(([word, senses]) => ({
      word,
      senses: [...senses].sort((a, b) =>
        a.senseLabel.localeCompare(b.senseLabel, "as"),
      ),
    }))
    .sort((a, b) => a.word.localeCompare(b.word, "as"));
}

export function buildSenseInventoryExport(
  rows: SenseInventoryRow[],
  format: WsdExportFormat,
  workspaceId: string,
): ExportFile {
  if (format === "csv") {
    const table: unknown[][] = [["word", "sense_label", "description"]];
    for (const row of rows) {
      table.push([row.word, row.senseLabel, row.description ?? ""]);
    }
    return {
      filename: `wsd_senses_${workspaceId}.csv`,
      contentType: "text/csv; charset=utf-8",
      body: csv(table),
    };
  }

  const groups = groupSenses(rows);
  const maxSenses = Math.max(1, ...groups.map((group) => group.senses.length));

  const header: unknown[] = ["Sl No", "Assamese Ambiguous Words"];
  const subheader: unknown[] = ["", ""];
  for (let i = 0; i < maxSenses; i++) {
    header.push(`Sense${i + 1}`, "");
    subheader.push("Assamese", "English");
  }
  header.push("Number of Total Senses");
  subheader.push("");

  const table: unknown[][] = [header, subheader];
  groups.forEach((group, index) => {
    const row: unknown[] = [index + 1, group.word];
    for (let i = 0; i < maxSenses; i++) {
      const sense = group.senses[i];
      row.push(sense?.senseLabel ?? "", sense?.description ?? "");
    }
    row.push(group.senses.length);
    table.push(row);
  });

  const sheet = XLSX.utils.aoa_to_sheet(table);
  sheet["!cols"] = [
    { wch: 6 },
    { wch: 28 },
    ...Array.from({ length: maxSenses * 2 }, () => ({ wch: 24 })),
    { wch: 12 },
  ];
  sheet["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },
    { s: { r: 0, c: 1 }, e: { r: 1, c: 1 } },
    ...Array.from({ length: maxSenses }, (_, i) => ({
      s: { r: 0, c: 2 + i * 2 },
      e: { r: 0, c: 3 + i * 2 },
    })),
    { s: { r: 0, c: 2 + maxSenses * 2 }, e: { r: 1, c: 2 + maxSenses * 2 } },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Ambiguous Words");
  return {
    filename: `wsd_senses_${workspaceId}.xlsx`,
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    body: workbookBuffer(workbook),
  };
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
  "sense_description",
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
      row.senseDescription ?? "",
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
