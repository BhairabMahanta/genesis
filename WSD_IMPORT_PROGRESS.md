# WSD import / progress work log

This branch builds on the upstream WSD editor (dictionary import, matching,
pagination, rejections) and adds the missing pieces around it.

## Upstream baseline (already present)

- JSON / JSONL / CSV / TSV dictionary import via the editor modal.
- Server-side sense search and pagination.
- Ambiguous-word matching API and highlighted-token navigation.
- Register-word dialog, add-sense form, per-annotator ✗ rejections.
- V9 migration for `wsd_sense.gloss`, `wsd_sense.examples` and
  `wsd_sense_rejection`.
- Re-importable JSONL/CSV dictionary export.

## Added on this branch

### Import

- Binary `.xls` / `.xlsx` / `.xlsm` support for the original Assamese
  ambiguous-word template:
  `Sl No | Assamese Ambiguous Words | Sense1 Assamese/English | ...`
- Helper sheets (e.g. `Sheet2`, `Compatibility Report`) are ignored.
- Assamese sense text maps to `senseLabel`; English text maps to `gloss`.
- The same endpoint still accepts JSON, JSONL, CSV and TSV.
- Re-import is idempotent through the upstream `(word, senseLabel)` dedupe.

### Annotation output

- `GET /api/workspaces/:id/wsd/export/annotations?format=csv|xlsx` — one row per
  annotation with document, sentence/token position, sentence text, sense
  id/label/gloss/examples, annotator id/display name and timestamp.
- Next route `/api/wsd/:workspaceId/export/annotations` proxies the download
  through the auth cookie; CSV includes a UTF-8 BOM.
- Export button in the Sense Inventory page and the WSD editor header.

### Progress

- `documents.progress` = annotated ambiguous tokens / all ambiguous tokens,
  where an ambiguous token is an exact match against the workspace sense words.
- Distinct tokens are counted, so multiple annotators on one token do not
  inflate progress.
- Recomputed on annotation create/delete and on a ✗ that removes an annotation.
- First annotation moves the document to `ANNOTATING`.
- WSD workspace `progressPercentage` is token-weighted coverage across all
  documents with one decimal, so zero-match documents do not drag it down and
  the first tags do not display as 0%.
- `annotatedDocumentCount` counts documents with progress > 0 or `COMPLETE`.

### Document upload

- Encoding-aware decoding for `.txt` / `.text` / `.conll` / `.conll2012`:
  UTF-8, UTF-8 BOM, UTF-16LE/BE (with or without BOM) and windows-1252.
  Uploads are normalized to UTF-8 before storage, and storage reads decode
  legacy files too.
- Rejects spreadsheets and genuinely binary files in the document upload path
  with a pointer to the dictionary importer.
- Multi-file document upload with progress, per-file failures, duplicate-name
  protection, and one revalidation per batch.

### Workspace UI

- Standalone Sense Inventory page for WSD workspaces (visible even with no
  documents): grouped word/sense list, search, counts, admin add/edit/delete,
  dictionary/annotation exports, and word-list import.
- Sidebar item and Getting Started card link to it.

## Verification

- `pnpm --filter @genesis/api typecheck`
- `pnpm --filter @genesis/api test` — 38/38 passing (smoke, upstream WSD editor
  and importer suites, Excel parser, text encoding).
- `pnpm --filter @genesis/web exec tsc --noEmit`
- `pnpm --filter @genesis/web build`
- Real `ambiguouswords.xls`: 264 senses across 99 unique words; V9 backfills the
  existing `description` column into `gloss`.

## Known limitations

- Exact token-form matching only; inflected Assamese forms become separate
  entries unless added/registered in the editor.
- No DB unique constraint on `(workspace_id, word, sense_label)`; concurrent
  creates can theoretically race.
- Import/inline sense creation are not written to `annotation_log` because the
  existing check constraint limits action types.
- The in-app annotation view is still CSV/XLSX only; there is no occurrence table.
