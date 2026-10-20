/**
 * Line-oriented sentence segmenter. Port of `LineSentenceSegmenter.java`.
 *
 * Line breaks are always sentence boundaries; within a line, sentences end
 * at `. ? ! । ॥` (Devanagari dandas included) followed by whitespace or
 * end-of-line. Offsets are UTF-16 character offsets into the full text,
 * matching the Java implementation.
 */

export interface SentenceResult {
  text: string;
  startOffset: number;
  endOffset: number;
}

const SENTENCE_END = new Set([".", "?", "!", "।", "॥"]);

function isWhitespace(ch: string): boolean {
  return /\s/u.test(ch);
}

function segmentLine(line: string, lineStartOffset: number): SentenceResult[] {
  const out: SentenceResult[] = [];
  const chars = [...line];
  let sentenceStart = 0;

  const pushSentence = (beginChar: number, endChar: number): void => {
    const raw = chars.slice(beginChar, endChar).join("");
    const text = raw.trim();
    if (text === "") return;
    // Leading whitespace is not part of the sentence.
    let begin = beginChar;
    while (begin < endChar && isWhitespace(chars[begin] as string)) begin++;
    // Trailing whitespace is not part of the sentence either.
    let end = endChar;
    while (end > begin && isWhitespace(chars[end - 1] as string)) end--;
    // Convert char indices to UTF-16 offsets.
    let beginOff = lineStartOffset;
    for (let i = 0; i < begin; i++) beginOff += (chars[i] as string).length;
    let endOff = lineStartOffset;
    for (let i = 0; i < end; i++) endOff += (chars[i] as string).length;
    out.push({ text, startOffset: beginOff, endOffset: endOff });
  };

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] as string;
    if (!SENTENCE_END.has(ch)) continue;
    const next = chars[i + 1];
    if (next === undefined || isWhitespace(next)) {
      // Include the terminator plus following whitespace (Java `matcher.end()`),
      // then trim inside pushSentence.
      let end = i + 1;
      while (end < chars.length && isWhitespace(chars[end] as string)) end++;
      pushSentence(sentenceStart, end);
      sentenceStart = end;
      i = end - 1;
    }
  }

  if (sentenceStart < chars.length) {
    pushSentence(sentenceStart, chars.length);
  }
  if (out.length === 0 && line.trim() !== "") {
    pushSentence(0, chars.length);
  }
  return out;
}

export function segment(text: string): SentenceResult[] {
  if (text === null || text === undefined || text === "") return [];
  const out: SentenceResult[] = [];
  const lines = text.split(/\r?\n/);
  let currentOffset = 0;
  for (const line of lines) {
    if (line.trim() === "") {
      currentOffset += line.length + 1;
      continue;
    }
    // `indexOf(line, currentOffset)` mirrors the Java line lookup.
    let lineStart = text.indexOf(line, currentOffset);
    if (lineStart === -1) lineStart = currentOffset;
    out.push(...segmentLine(line, lineStart));
    currentOffset = lineStart + line.length + 1;
  }
  return out;
}
