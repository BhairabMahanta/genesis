/**
 * Port of `StopWordFilter`: hardcoded Assamese function words removed from
 * Rule 3 (STRING_MATCH) so common particles don't surface as candidates.
 * Conservative on purpose — a borderline word is kept rather than dropped.
 */

const ASSAMESE_STOP_WORDS = new Set([
  // Demonstratives
  "এই", "সেই", "ই",
  // Locative particles
  "ত", "ৰ", "ক", "লৈ",
  // Coordinating conjunctions
  "আৰু", "কিন্তু", "অথবা",
  // Subordinating conjunctions / interrogatives
  "যদি", "যেতিয়া", "যিহেতু", "যি",
  // Common pronouns
  "তেওঁ", "মই", "আমি", "তুমি",
  // Common auxiliaries / verbs
  "হয়", "নাই", "আছিল",
]);

export function isStopWord(word: string | null | undefined): boolean {
  if (word == null) return false;
  return ASSAMESE_STOP_WORDS.has(word.trim());
}

/** Exposed for tests + telemetry (mirrors `stopWords()`). */
export function stopWords(): ReadonlySet<string> {
  return ASSAMESE_STOP_WORDS;
}
