import test from "node:test";
import assert from "node:assert/strict";
import { parseSenseImportContent } from "../src/services/wsd-importer.service.js";

test("wsd-importer: parses JSON array of senses", () => {
  const jsonContent = JSON.stringify([
    {
      word: "বতাহ",
      senseLabel: "বতাহ-১",
      gloss: "বায়ু; বতাহৰ সোঁত।",
      examples: "কালি নিশা বৰ বতাহ বলিছিল।",
    },
    {
      word: "পানী",
      label: "water-liquid",
      description: "জল, জীৱনধাৰণৰ বাবে অপৰিহাৰ্য তৰল পদাৰ্থ।",
    },
  ]);

  const senses = parseSenseImportContent(jsonContent, "hemkosh_sample.json");
  assert.equal(senses.length, 2);
  assert.equal(senses[0].word, "বতাহ");
  assert.equal(senses[0].senseLabel, "বতাহ-১");
  assert.equal(senses[0].gloss, "বায়ু; বতাহৰ সোঁত।");
  assert.equal(senses[0].examples, "কালি নিশা বৰ বতাহ বলিছিল।");

  assert.equal(senses[1].word, "পানী");
  assert.equal(senses[1].senseLabel, "water-liquid");
});

test("wsd-importer: parses JSONL format", () => {
  const jsonl = [
    '{"headword": "গছ", "sense_label": "গছ-১", "meaning": "উদ্ভিদ"}',
    '{"headword": "গছ", "sense_label": "গছ-২", "meaning": "কাঠ", "example": "শাল গছ"}',
  ].join("\n");

  const senses = parseSenseImportContent(jsonl, "hemkosh.jsonl");
  assert.equal(senses.length, 2);
  assert.equal(senses[0].word, "গছ");
  assert.equal(senses[0].senseLabel, "গছ-১");
  assert.equal(senses[0].gloss, "উদ্ভিদ");
  assert.equal(senses[1].examples, "শাল গছ");
});

test("wsd-importer: parses CSV format with quotes and commas", () => {
  const csv = [
    'word,sense_label,description,examples',
    'বতাহ,বতাহ-১,"বায়ু, বতাহৰ সোঁত",বতাহ বলিছে',
    'নৈ,নৈ-১,"নদী, নৈৰ পানী",নৈ বৈ যায়',
  ].join("\n");

  const senses = parseSenseImportContent(csv, "hemkosh.csv");
  assert.equal(senses.length, 2);
  assert.equal(senses[0].word, "বতাহ");
  assert.equal(senses[0].senseLabel, "বতাহ-১");
  assert.equal(senses[0].gloss, "বায়ু, বতাহৰ সোঁত");
  assert.equal(senses[0].examples, "বতাহ বলিছে");

  assert.equal(senses[1].word, "নৈ");
  assert.equal(senses[1].gloss, "নদী, নৈৰ পানী");
});

test("wsd-importer: parses TSV format", () => {
  const tsv = [
    "word\tsense_label\tgloss",
    "কিতাপ\tকিতাপ-১\tপুথি বা গ্ৰন্থ",
    "কলম\tকলম-১\tলিখাৰ আহিলা",
  ].join("\n");

  const senses = parseSenseImportContent(tsv, "hemkosh.tsv");
  assert.equal(senses.length, 2);
  assert.equal(senses[0].word, "কিতাপ");
  assert.equal(senses[0].senseLabel, "কিতাপ-১");
  assert.equal(senses[0].gloss, "পুথি বা গ্ৰন্থ");
});

test("wsd-importer: handles UTF-8 BOM", () => {
  const bomJson = "\uFEFF" + JSON.stringify([{ word: "সূৰ্য", senseLabel: "সূৰ্য-১", gloss: "বেলি" }]);
  const senses = parseSenseImportContent(bomJson, "bom.json");
  assert.equal(senses.length, 1);
  assert.equal(senses[0].word, "সূৰ্য");
});
