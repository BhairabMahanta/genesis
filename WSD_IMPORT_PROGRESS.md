# WSD Import / Annotation Progress

Track work for the WSD workspace fixes: real Excel sense import, visible sense inventory,
annotation-driven vocabulary growth, and annotation export.

## Problem being solved

- Uploading `ambiguouswords.xls` through the workspace **Import** button treated it as a
  plain-text document: the API stored the binary, read it as UTF-8, and tokenized the
  resulting garbage. It never wrote to `wsd_sense`.
- There is no Excel importer for the ambiguous-word list.
- The sense inventory is only visible in the WSD editor's left pane, and only when the
  workspace already has at least one document. There is no standalone view or export.
- Annotators cannot add a sense for a word that is not already in the inventory, so the
  list cannot grow from annotation work.

## Agreed behaviour

- Excel template layout: `word` = column B, each `SenseN` pair = Assamese label (column
  `sense_label`) + English description (column `description`).
- Import is admin-only and idempotent: append new `(word, senseLabel)` pairs, skip existing
  pairs case-insensitively.
- Text uploads remain annotation documents. They are tokenized and never seed the lexicon
  directly.
- Any workspace member can add a new sense inline while annotating a token. That creates the
  `wsd_sense` row and the `wsd_annotation`.
- Export annotated occurrences as CSV/XLSX with document, sentence, token, word, sentence
  text, sense, annotator, and timestamp.
- Export the current sense inventory in the original template shape for offline viewing and
  round-tripping.
- Spreadsheets/CSV are rejected by the document upload path with a clear message pointing to
  the Sense Inventory importer.

## Implementation checklist

### Progress file + dependency

- [x] Create this progress file.
- [x] Add an Excel parser to `@genesis/api` (SheetJS `xlsx` 0.20.3 via CDN tarball).

### Backend — sense import / export

- [x] Add `apps/api/src/services/wsd-sense-import.service.ts`.
  - [x] Detect the correct sheet by header (`Assamese Ambiguous Words`), ignoring helper sheets.
  - [x] Parse `Sense1..SenseN` blocks with `Assamese`/`English` subheaders.
  - [x] Support flat `word,sense_label,description` CSV/XLSX as a fallback layout.
  - [x] Normalize whitespace, validate lengths, dedupe pairs in-file.
  - [x] Return an import summary with row errors.
- [x] Add export builders (`apps/api/src/services/wsd-export.service.ts`):
  - [x] Current sense inventory in the original template layout (CSV/XLSX).
  - [x] Annotated occurrences (CSV/XLSX), one row per annotation.
- [x] Extend `apps/api/src/store/prisma.ts`.
  - [x] Batch create senses.
  - [x] Query annotations joined with token, document, and sense for export.
- [x] Extend `apps/api/src/services/wsd.service.ts`.
  - [x] `importSenses` (admin-only, dedupe against existing rows).
  - [x] `createSenseAndAnnotate` (member; word derived from the token).
  - [x] `exportSenseInventory` and `exportAnnotatedOccurrences`.
  - [x] Verify token/document belongs to the workspace on annotations (security gap fixed).
- [x] Extend schemas/routes.
  - [x] `POST /api/workspaces/:id/wsd/senses/import` (multipart, admin).
  - [x] `GET /api/workspaces/:id/wsd/export/senses?format=csv|xlsx` (member).
  - [x] `POST /api/workspaces/:id/wsd/annotations/with-sense` (member).
  - [x] `GET /api/workspaces/:id/wsd/export/annotations?format=csv|xlsx` (member).

### Backend — document upload validation / text encodings

- [x] Restrict document uploads to `.txt`, `.text`, `.conll`, `.conll2012`.
- [x] Reject spreadsheet/CSV/binary uploads with a 400 and a message pointing to the
  Sense Inventory importer.
- [x] Add the same restriction in the web file input (`accept`).
- [x] Fix the false "binary file" rejection for UTF-16 `.txt` files:
  - [x] Added `apps/api/src/services/text-encoding.ts` with UTF-8, UTF-8 BOM,
    UTF-16LE/BE (BOM and BOM-less, including non-ASCII Assamese), and
    windows-1252 detection.
  - [x] Uploads are normalized to UTF-8 before storage, so tokenization no longer
    depends on the source encoding.
  - [x] Storage `downloadAsString` now decodes stored bytes, so re-tokenizing an
    existing UTF-16 document also works.
  - [x] Binary detection now runs after decoding (NULs alone no longer mean binary).

### Frontend — Sense Inventory page

- [x] Add WSD-only `lexicon` section to the workspace sidebar.
- [x] Add `WsdLexicon` component (`apps/web/src/features/workspace/components/WsdLexicon.tsx`):
  - [x] Grouped word/sense table, search, word/sense counts.
  - [x] Add / edit / delete for admins.
  - [x] Import Excel/CSV (admin) with summary and row errors.
  - [x] Export word list and annotated occurrences.
- [x] Add a WSD "Ambiguous Words" card on the Getting Started page.
- [x] Surface real document-upload errors instead of a generic toast.

### Frontend — editor growth loop

- [x] Editor resolves the current member's role; the left inventory pane is read-only
  for non-admins (no add/edit/delete controls that would 403).
- [x] Replace the "Ask your admin" dead end in the WSD right pane with an inline
  "Add a sense for this word" form (Assamese label + English description).
- [x] Add an "Add another sense" action even when senses already exist.
- [x] Use a new atomic-ish action so the sense and annotation are saved together.
- [x] Refresh the left inventory after inline creation.

### WSD progress tracking

- [x] Document progress is now `annotated ambiguous tokens / all ambiguous tokens`
  (distinct tokens; multiple annotators on one token do not inflate it).
- [x] Progress recomputes after every annotation create/delete and inline sense add.
- [x] First annotation moves a document from `UPLOADED` to `ANNOTATING`.
- [x] WSD workspace percentage is token-weighted coverage across all documents
  (documents with zero matching words no longer drag it down), with one decimal so
  the first few tags do not render as 0%.
- [x] WSD `annotatedDocumentCount` counts documents with annotations or complete status.
- [x] The editor header/stat panel now counts **ambiguous occurrences** (exact lexicon
  matches) rather than every token, and its progress bar uses that denominator.
- [x] Ambiguous tokens are highlighted violet with a dot; arrow/Tab navigation jumps
  between them instead of walking tens of thousands of ordinary tokens. Clicking any
  other token still works, so new senses can be added manually.
- [x] Smoke test asserts document and workspace progress move from 0 after a tag.

### Frontend — batch document upload

- [x] Document picker accepts multiple files at once.
- [x] Uploads run sequentially with `done/total` progress.
- [x] Per-file failures are listed by name and reason instead of aborting the batch.
- [x] Duplicate file names are rejected (against existing documents and within the batch).
- [x] Revalidation is skipped per file and runs once after the batch.
- [x] One summary toast and one RSC refresh after the batch.

### Frontend — export plumbing

- [x] Add a Next route handler that proxies sense/annotation exports with the auth cookie.
- [x] Protect `/api/wsd` in middleware so token refresh runs before downloads.
- [x] Return UTF-8 CSV with BOM so Assamese opens correctly in Excel.
- [x] Add an "Export CSV" button to the WSD editor header as a shortcut to the
  annotation download.

### Tests / verification

- [x] Unit-test the workbook parser with generated `.xlsx` and CSV fixtures.
- [x] Test import idempotency (second import creates zero rows).
- [x] Test inline sense + annotation creation.
- [x] Test annotation export columns/content.
- [x] Test legacy `.xls` (BIFF8) parsing in addition to `.xlsx`/CSV.
- [x] Test `.xls` document upload is rejected and `.txt` still works.
- [x] Run `pnpm --filter @genesis/api typecheck` — passed.
- [x] Run `pnpm --filter @genesis/api test` — 25/25 passed (smoke + parser/export + encoding).
- [x] Run `pnpm --filter @genesis/web exec tsc --noEmit` — passed.
- [x] Run `pnpm --filter @genesis/web build` with local API env vars — passed; new route
  `/api/wsd/[workspaceId]/export/[kind]` is present.
- [x] Update `apps/api/README.md` WSD section.

### Cleanup / rollout

- [ ] Import `ambiguouswords.xls` into the real WSD workspace after the dev server restarts.
  Use **Workspace → Sense Inventory → Import Excel list**.
- [x] Verify the sample file parses: **264 senses** across **99 unique words** (101 data
  rows; two words appear on more than one row).
- [ ] Delete any accidental `.xls` document from the workspace Documents view.

## Verification snapshot

- Parser against the real `ambiguouswords.xls`: sheet `Sheet1`, 264 rows, 0 errors.
- API smoke test added: create WSD workspace → import workbook → re-import (0 new) →
  reject `.xls` as a document → upload `.txt` → inline sense+annotation → export CSV and
  XLSX.
- `next build` needs `NEXT_PUBLIC_API_URL` / `INTERNAL_API_URL` in production mode; use
  `NEXT_STANDALONE=false` on Windows accounts without symlink privileges.

## Implementation notes

- The Flyway-owned `annotation_log` table has a check constraint that only allows the
  existing action types (`WSD_ANNOTATED` among them). Import and inline sense creation
  therefore do **not** invent new log types; the annotation itself still writes
  `WSD_ANNOTATED`. Expanding the constraint would require a new Flyway migration.
- No DB schema migration was needed for the feature: `wsd_sense` already stores `word`,
  `sense_label`, and `description`.

## Current data audit (local `assamese` workspace)

- 264 senses / 99 unique dictionary words imported successfully.
- 51 documents, 66,266 tokens, all `processing_status = COMPLETED`.
- 418 tokens match an imported word exactly.
- 4,213 tokens match by prefix (`token starts with word`) — the extra ~3,800 are
  inflected forms that the current exact-match rule does not treat as ambiguous.
- 0 WSD annotations before the progress fix, so 0% was mathematically correct; the UI
  simply never updated progress for WSD annotations.

## Known limitations / later work

- Documents uploaded before the encoding fix may still contain garbage tokens if they were
  UTF-16. Re-run the internal re-tokenize endpoint
  (`POST /api/editor/documents/:documentId/tokenize`) or delete and re-upload the document.
- Matching is exact `token.form = sense.word`; inflected Assamese forms become separate
  lexicon entries until a lemma/normalization layer is added. A conservative prefix/lemma
  match would raise the current 418 exact occurrences to about 4,213, but needs a product
  decision because prefix matching can produce false positives.
- Concurrent inline creation can theoretically race because there is no DB unique constraint
  on `(workspace_id, word, sense_label)`; the service-level check covers normal use.
- Consensus-specific export is not included; annotation export is per-annotator row data.
- If a sense is created and the subsequent annotation write fails, the new sense remains
  in the inventory (benign; it can be edited or deleted by an admin).
