import * as XLSX from "xlsx";
import { BadRequestException } from "../common/errors.js";

/**
 * Excel/CSV parsing for the WSD ambiguous-word list.
 *
 * Two layouts are supported:
 *
 * 1. The original template:
 *      Sl No | Assamese Ambiguous Words | Sense1 (Assamese | English) | ...
 *    where the `SenseN` cells are merged across a pair of columns and row 2
 *    holds the `Assamese` / `English` subheaders.
 *
 * 2. A flat table:
 *      word | sense_label | gloss
 *    which is what the CSV export produces.
 *
 * The parser never evaluates formulas and never touches the database, so it is
 * safe to unit-test with generated workbooks.
 */

export interface ParsedSenseRow {
  /** 1-based row number in the source sheet, for error messages. */
  rowNumber: number;
  word: string;
  senseLabel: string;
  gloss: string | null;
}

export interface SenseRowError {
  rowNumber: number;
  message: string;
}

export interface ParsedSenseWorkbook {
  sheetName: string;
  rows: ParsedSenseRow[];
  errors: SenseRowError[];
  /** Pairs repeated inside the uploaded file. */
  duplicatesInFile: number;
}

const MAX_ROWS = 5000;
const MAX_WORD_LENGTH = 200;
const MAX_LABEL_LENGTH = 200;
const MAX_GLOSS_LENGTH = 2000;

type CellRow = unknown[];

interface TemplateLayout {
  kind: "template";
  headerRow: number;
  dataStart: number;
  wordCol: number;
  blocks: Array<{ labelCol: number; glossCol: number | null }>;
}

interface FlatLayout {
  kind: "flat";
  headerRow: number;
  dataStart: number;
  wordCol: number;
  labelCol: number;
  glossCol: number | null;
}

type Layout = TemplateLayout | FlatLayout;

function cell(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cellLower(value: unknown): string {
  return cell(value).toLowerCase();
}

function looksLikeSummary(value: string): boolean {
  return /^(no\.?\s*of|number\s+of|total)\b/i.test(value);
}

function detectLayout(rows: CellRow[]): Layout | null {
  const scanLimit = Math.min(rows.length, 30);

  for (let headerRow = 0; headerRow < scanLimit; headerRow++) {
    const header = rows[headerRow] ?? [];
    const headerText = header.map(cell);

    const senseColumns = headerText
      .map((value, index) => ({ value, index }))
      .filter(({ value }) => /^sense\s*\d+$/i.test(value));

    if (senseColumns.length > 0) {
      const wordCol = headerText.findIndex((value) =>
        /assamese\s+ambiguous\s+words?/i.test(value),
      );
      const subheader = rows[headerRow + 1] ?? [];
      const hasLanguageSubheader = subheader.some((value) => {
        const text = cellLower(value);
        return text === "assamese" || text === "english";
      });

      const blocks = senseColumns.map(({ index }) => {
        const left = cellLower(subheader[index]);
        const right = cellLower(subheader[index + 1]);
        if (left === "assamese") {
          return { labelCol: index, glossCol: right === "english" ? index + 1 : null };
        }
        if (right === "assamese") {
          return { labelCol: index + 1, glossCol: left === "english" ? index : null };
        }
        if (left === "english") {
          // A single English-only sense column still becomes a label.
          return { labelCol: index, glossCol: null };
        }
        return { labelCol: index, glossCol: null };
      });

      return {
        kind: "template",
        headerRow,
        dataStart: headerRow + (hasLanguageSubheader ? 2 : 1),
        wordCol: wordCol >= 0 ? wordCol : 1,
        blocks,
      };
    }

    // Flat layout: word + sense_label + gloss (CSV export shape).
    const wordCol = headerText.findIndex((value) =>
      /^(assamese\s+)?(ambiguous\s+)?words?$/i.test(value),
    );
    const labelCol = headerText.findIndex((value) =>
      /^(sense|sense[_\s-]?label|sense label)$/i.test(value),
    );
    if (wordCol >= 0 && labelCol >= 0) {
      const glossCol = headerText.findIndex((value) =>
        /gloss|description|english|meaning/i.test(value),
      );
      return {
        kind: "flat",
        headerRow,
        dataStart: headerRow + 1,
        wordCol,
        labelCol,
        glossCol: glossCol >= 0 ? glossCol : null,
      };
    }
  }

  return null;
}

function readWorkbook(bytes: Uint8Array, filename: string): XLSX.WorkBook {
  try {
    if (filename.toLowerCase().endsWith(".csv")) {
      const text = new TextDecoder("utf-8")
        .decode(bytes)
        .replace(/^\uFEFF/, "");
      return XLSX.read(text, { type: "string", sheetRows: MAX_ROWS + 1 });
    }

    return XLSX.read(bytes, {
      type: "array",
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      sheetRows: MAX_ROWS + 1,
    });
  } catch {
    throw new BadRequestException(
      "Could not read the uploaded spreadsheet. Supported formats are .xls, .xlsx, .xlsm and .csv.",
    );
  }
}

function sheetRows(workbook: XLSX.WorkBook, sheetName: string): CellRow[] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: true,
  }) as CellRow[];
}

/**
 * Parse an uploaded ambiguous-word workbook. Throws when no recognizable
 * header is present; per-row problems are returned in `errors` so a partially
 * valid file can still be imported.
 */
export function parseSenseWorkbook(
  bytes: Uint8Array,
  filename: string,
): ParsedSenseWorkbook {
  const workbook = readWorkbook(bytes, filename);
  if (workbook.SheetNames.length === 0) {
    throw new BadRequestException("The uploaded spreadsheet contains no sheets.");
  }

  for (const sheetName of workbook.SheetNames) {
    const rows = sheetRows(workbook, sheetName);
    if (rows.length === 0) continue;

    const layout = detectLayout(rows);
    if (!layout) continue;

    const parsed = parseSheet(rows, layout);
    return { sheetName, ...parsed };
  }

  throw new BadRequestException(
    "Unrecognized spreadsheet layout. Expected the original template " +
      "(Assamese Ambiguous Words + Sense1..SenseN with Assamese/English columns) " +
      "or a flat table with word, sense_label and gloss columns.",
  );
}

function parseSheet(
  rows: CellRow[],
  layout: Layout,
): { rows: ParsedSenseRow[]; errors: SenseRowError[]; duplicatesInFile: number } {
  const parsedRows: ParsedSenseRow[] = [];
  const errors: SenseRowError[] = [];
  const seen = new Set<string>();
  let duplicatesInFile = 0;

  const dataEnd = Math.min(rows.length, layout.dataStart + MAX_ROWS);

  for (let rowIndex = layout.dataStart; rowIndex < dataEnd; rowIndex++) {
    const row = rows[rowIndex] ?? [];
    const word = cell(row[layout.wordCol]);

    if (!word) {
      const hasSense =
        layout.kind === "flat"
          ? cell(row[layout.labelCol]) !== ""
          : layout.blocks.some(
              (block) =>
                cell(row[block.labelCol]) !== "" ||
                (block.glossCol != null && cell(row[block.glossCol]) !== ""),
            );
      if (hasSense) {
        errors.push({ rowNumber: rowIndex + 1, message: "Missing ambiguous word" });
      }
      continue;
    }

    if (looksLikeSummary(word)) continue;

    if (word.length > MAX_WORD_LENGTH) {
      errors.push({
        rowNumber: rowIndex + 1,
        message: `Word exceeds ${MAX_WORD_LENGTH} characters`,
      });
      continue;
    }

    const candidates =
      layout.kind === "flat"
        ? [
            {
              label: cell(row[layout.labelCol]),
              gloss:
                layout.glossCol == null ? "" : cell(row[layout.glossCol]),
            },
          ]
        : layout.blocks.map((block) => ({
            label: cell(row[block.labelCol]),
            gloss:
              block.glossCol == null ? "" : cell(row[block.glossCol]),
          }));

    for (const candidate of candidates) {
      let label = candidate.label;
      let gloss = candidate.gloss;

      if (!label && !gloss) continue;
      if (!label) {
        // English-only cell: use the gloss as the label so the sense is usable.
        label = gloss;
        gloss = "";
      }
      if (!label) continue;

      if (label.length > MAX_LABEL_LENGTH) {
        errors.push({
          rowNumber: rowIndex + 1,
          message: `Sense label exceeds ${MAX_LABEL_LENGTH} characters`,
        });
        continue;
      }
      if (gloss.length > MAX_GLOSS_LENGTH) {
        errors.push({
          rowNumber: rowIndex + 1,
          message: `Sense gloss exceeds ${MAX_GLOSS_LENGTH} characters`,
        });
        continue;
      }

      const key = `${word.toLowerCase()}\u0000${label.toLowerCase()}`;
      if (seen.has(key)) {
        duplicatesInFile += 1;
        continue;
      }
      seen.add(key);

      parsedRows.push({
        rowNumber: rowIndex + 1,
        word,
        senseLabel: label,
        gloss: gloss || null,
      });
    }
  }

  return { rows: parsedRows, errors, duplicatesInFile };
}
