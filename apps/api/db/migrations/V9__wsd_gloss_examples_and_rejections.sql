-- TypeScript-owned migration (V1–V8 are the legacy Flyway baseline in
-- legacy/genesis-java/.../db/migration; scripts/db-migrate.sh applies both in order).
--
-- 1. Gloss and examples become their own columns. Until now the importer packed
--    them into `description` as "<gloss>\nExamples: <examples>".
-- 2. Annotators' ✗ ("this sense does not fit here") is persisted per token/sense/annotator.

ALTER TABLE wsd_sense
    ADD COLUMN IF NOT EXISTS gloss    TEXT,
    ADD COLUMN IF NOT EXISTS examples TEXT;

-- Backfill from the packed description. `description` stays in place (the TypeScript API
-- no longer reads or writes it) so the migration is non-destructive.
UPDATE wsd_sense
   SET gloss    = NULLIF(btrim(regexp_replace(description, '(^|\n)Examples?:.*$', '', 'is')), ''),
       examples = NULLIF(btrim((regexp_match(description, '(?:^|\n)Examples?:\s*(.*)$', 'is'))[1]), '')
 WHERE description IS NOT NULL
   AND gloss IS NULL
   AND examples IS NULL;

CREATE TABLE IF NOT EXISTS wsd_sense_rejection (
    id           uuid PRIMARY KEY,
    workspace_id uuid         NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    document_id  uuid         NOT NULL REFERENCES documents (id)  ON DELETE CASCADE,
    token_id     uuid         NOT NULL REFERENCES tokens (id)     ON DELETE CASCADE,
    sense_id     uuid         NOT NULL REFERENCES wsd_sense (id)  ON DELETE CASCADE,
    annotator_id varchar(100) NOT NULL,
    created_at   timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uq_wsd_rejection UNIQUE (token_id, sense_id, annotator_id)
);

CREATE INDEX IF NOT EXISTS idx_wsd_rejection_ws_doc_annotator
    ON wsd_sense_rejection (workspace_id, document_id, annotator_id);
