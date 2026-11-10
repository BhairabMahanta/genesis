import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  parseSenseWorkbook,
} from "../src/services/wsd-sense-import.service.js";
import {
  buildAnnotationExport,
  buildSenseInventoryExport,
} from "../src/services/wsd-export.service.js";

function templateWorkbook(): Uint8Array {
  const table: unknown[][] = [
    [
      "Sl No",
      "Assamese Ambiguous Words",
      "Sense1",
      "",
      "Sense2",
      "",
      "Number of Total Senses",
    ],
    ["", "", "Assamese", "English", "Assamese", "English", ""],
    [1, "অংক", "গণিত", "Mathematics", "চিন", "a mark", 2],
    [2, "জাল", "মাছ ধৰা সঁজুলি", "fishing net", "", "", 1],
    // Duplicate pair: should be counted and skipped, not imported twice.
    [3, "অংক", "গণিত", "Mathematics", "", "", 1],
    // Missing word with a sense: should surface a row error.
    [4, "", "অৰ্থহীন", "meaningless", "", "", 1],
  ];

  const sheet = XLSX.utils.aoa_to_sheet(table);
  sheet["!merges"] = [
    { s: { r: 0, c: 2 }, e: { r: 0, c: 3 } },
    { s: { r: 0, c: 4 }, e: { r: 0, c: 5 } },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  return new Uint8Array(
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer,
  );
}

test("parseSenseWorkbook reads the template layout", () => {
  const parsed = parseSenseWorkbook(templateWorkbook(), "words.xlsx");
  assert.equal(parsed.sheetName, "Sheet1");
  assert.equal(parsed.rows.length, 3);
  assert.equal(parsed.duplicatesInFile, 1);
  assert.equal(parsed.errors.length, 1);

  assert.deepEqual(parsed.rows[0], {
    rowNumber: 3,
    word: "অংক",
    senseLabel: "গণিত",
    description: "Mathematics",
  });
  assert.deepEqual(parsed.rows[1], {
    rowNumber: 3,
    word: "অংক",
    senseLabel: "চিন",
    description: "a mark",
  });
  assert.equal(parsed.rows[2]?.word, "জাল");
  assert.equal(parsed.rows[2]?.description, "fishing net");
});

test("parseSenseWorkbook reads a legacy .xls (BIFF8) workbook", () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Sl No", "Assamese Ambiguous Words", "Sense1", "", "Number of Total Senses"],
    ["", "", "Assamese", "English", ""],
    [1, "অংক", "গণিত", "Mathematics", 1],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  const bytes = new Uint8Array(
    XLSX.write(workbook, { type: "buffer", bookType: "biff8" }) as Buffer,
  );

  const parsed = parseSenseWorkbook(bytes, "legacy.xls");
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0]?.word, "অংক");
  assert.equal(parsed.rows[0]?.senseLabel, "গণিত");
  assert.equal(parsed.rows[0]?.description, "Mathematics");
});

test("parseSenseWorkbook reads a flat CSV with a BOM", () => {
  const csv = "\uFEFFword,sense_label,description\r\nঅংক,গণিত,Mathematics\r\nঅংক,চিন,a mark\r\n";
  const parsed = parseSenseWorkbook(
    new TextEncoder().encode(csv),
    "words.csv",
  );
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0]?.word, "অংক");
  assert.equal(parsed.rows[0]?.senseLabel, "গণিত");
  assert.equal(parsed.rows[1]?.description, "a mark");
});

test("parseSenseWorkbook rejects an unrecognized layout", () => {
  const sheet = XLSX.utils.aoa_to_sheet([["hello", "world"]]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Nope");
  const bytes = new Uint8Array(
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer,
  );
  assert.throws(
    () => parseSenseWorkbook(bytes, "nope.xlsx"),
    /Unrecognized spreadsheet layout/,
  );
});

test("buildSenseInventoryExport round-trips the template shape", () => {
  const file = buildSenseInventoryExport(
    [
      { word: "অংক", senseLabel: "গণিত", description: "Mathematics" },
      { word: "অংক", senseLabel: "চিন", description: "a mark" },
      { word: "জাল", senseLabel: "মাছ ধৰা সঁজুলি", description: "fishing net" },
    ],
    "xlsx",
    "workspace-id",
  );

  assert.equal(file.contentType.includes("spreadsheetml"), true);
  const workbook = XLSX.read(file.body as Uint8Array, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
  assert.ok(sheet);
  const table = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
  });
  assert.equal(table[0]?.[1], "Assamese Ambiguous Words");
  assert.equal(table[0]?.[2], "Sense1");
  assert.equal(table[2]?.[1], "অংক");

  // The exported workbook must be importable again.
  const parsed = parseSenseWorkbook(file.body as Uint8Array, "roundtrip.xlsx");
  assert.equal(parsed.rows.length, 3);
});

test("buildAnnotationExport emits one row per annotation with a BOM", () => {
  const file = buildAnnotationExport(
    [
      {
        documentId: "doc-1",
        documentName: "corpus.txt",
        sentenceIndex: 2,
        tokenIndex: 4,
        tokenId: "token-1",
        word: "অংক",
        sentenceText: "এই অংকটো কঠিন",
        senseId: "sense-1",
        senseLabel: "গণিত",
        senseDescription: "Mathematics",
        annotatorId: "user-1",
        annotatorName: "Smoke Annotator",
        timestamp: "2026-11-10T00:00:00.000Z",
      },
    ],
    "csv",
    "workspace-id",
  );

  const text = file.body as string;
  assert.equal(text.startsWith("\uFEFF"), true);
  assert.match(text, /document_id,document_name,sentence_index/);
  assert.match(text, /corpus\.txt/);
  assert.match(text, /sense-1/);
  assert.match(text, /গণিত/);
  assert.match(text, /Smoke Annotator/);
  assert.match(text, /2026-11-10T00:00:00.000Z/);
});
