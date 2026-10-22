/**
 * Unicode-aware tokenizer. Port of `UnicodeTokenizer.java`.
 *
 * Char-by-char scan (no regex): whitespace delimits, letter/digit/mark
 * runs form word tokens (covers English plus Assamese, Bengali, Hindi,
 * Bodo, Marathi, Nepali, Odia, Punjabi, Tamil, Telugu, Malayalam,
 * Kannada, Gujarati), punctuation chars form single-char tokens, and
 * anything else is skipped. ZWNJ/ZWJ join Indic conjuncts into words.
 *
 * Internal apostrophes (' and ’) between word characters are preserved
 * within words to support Indic vowel elision (e.g., Assamese গ'ল, হ'ল)
 * as well as contractions (e.g., don't, it's).
 */

export interface TokenResult {
  text: string;
  startOffset: number;
  endOffset: number;
}

export const SUPPORTED_LANGUAGES = new Set([
  "as", "bn", "hi", "brx", "en", "mr", "ne", "or", "pa", "ta", "te", "ml", "kn", "gu",
]);

const ZWNJ = 0x200c;
const ZWJ = 0x200d;

function isWhitespace(ch: string): boolean {
  return /\s/u.test(ch);
}

function isLetterOrDigit(ch: string): boolean {
  return /\p{L}|\p{N}/u.test(ch);
}

function isMark(ch: string): boolean {
  return /\p{Mn}|\p{Mc}|\p{Me}/u.test(ch);
}

function isIndianScriptConnector(codePoint: number): boolean {
  return codePoint === ZWNJ || codePoint === ZWJ;
}

function isIndianPunctuation(codePoint: number): boolean {
  return (
    codePoint === 0x0964 || // danda ।
    codePoint === 0x0965 || // double danda ॥
    codePoint === 0x0970 || // abbreviation sign
    codePoint === 0x09f7 || // Bengali currency numerator section
    codePoint === 0x201c ||
    codePoint === 0x201d ||
    codePoint === 0x2018 ||
    codePoint === 0x2019
  );
}

function isWordCharacter(ch: string): boolean {
  if (isLetterOrDigit(ch) || isMark(ch)) return true;
  const cp = ch.codePointAt(0) ?? 0;
  return isIndianScriptConnector(cp);
}

function isApostrophe(ch: string): boolean {
  return ch === "'" || ch === "’";
}

function isPunctuation(ch: string): boolean {
  if (/\p{Ps}|\p{Pe}|\p{Pc}|\p{Pd}|\p{Pi}|\p{Pf}|\p{Po}/u.test(ch)) return true;
  const cp = ch.codePointAt(0) ?? 0;
  return isIndianPunctuation(cp);
}

export function tokenize(text: string, startOffset = 0): TokenResult[] {
  if (text === null || text === undefined || text === "") return [];
  const out: TokenResult[] = [];
  const chars = [...text];
  // Map each char index to its UTF-16 offset for Java-compatible offsets.
  const utf16Offsets: number[] = [];
  let acc = 0;
  for (const ch of chars) {
    utf16Offsets.push(acc);
    acc += ch.length;
  }

  let pos = 0;
  while (pos < chars.length) {
    const ch = chars[pos] as string;
    if (isWhitespace(ch)) {
      pos++;
      continue;
    }
    if (isWordCharacter(ch)) {
      const tokenStart = pos;
      while (pos < chars.length) {
        if (isWordCharacter(chars[pos] as string)) {
          pos++;
        } else if (
          isApostrophe(chars[pos] as string) &&
          pos + 1 < chars.length &&
          isWordCharacter(chars[pos + 1] as string)
        ) {
          // Internal apostrophe elision (Assamese গ'ল, হ'ল) or contraction (don't)
          pos++;
        } else {
          break;
        }
      }
      const tokenText = chars.slice(tokenStart, pos).join("");
      const begin = (utf16Offsets[tokenStart] as number) + startOffset;
      const end = (pos < chars.length
        ? (utf16Offsets[pos] as number)
        : acc) + startOffset;
      out.push({ text: tokenText, startOffset: begin, endOffset: end });
    } else if (isPunctuation(ch)) {
      const begin = (utf16Offsets[pos] as number) + startOffset;
      out.push({ text: ch, startOffset: begin, endOffset: begin + ch.length });
      pos++;
    } else {
      // Skip anything else (symbols, unassigned code points) — matches Java.
      pos++;
    }
  }
  return out;
}

export function supportsLanguage(language: string | null | undefined): boolean {
  if (language === null || language === undefined) return true;
  return SUPPORTED_LANGUAGES.has(language.toLowerCase());
}
