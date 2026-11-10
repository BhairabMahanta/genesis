/**
 * Text-file decoding for uploaded corpora.
 *
 * `.txt` files are not always UTF-8: Windows editors commonly produce UTF-16
 * LE (with a BOM), and some exports omit the BOM. Treating those bytes as
 * UTF-8 produces replacement characters and NULs, and a naive "contains a NUL
 * byte → binary" check rejects perfectly valid text files.
 *
 * This module detects the common encodings, decodes to a JS string, and flags
 * content that still looks binary after decoding so the upload layer can reject
 * actual binaries without rejecting UTF-16 text.
 */

export type TextEncoding = "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";

export interface DecodedText {
  text: string;
  encoding: TextEncoding;
  /** True when the decoded text still contains NULs/control characters. */
  suspiciousBinary: boolean;
}

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

function hasUtf16LeBom(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe;
}

function hasUtf16BeBom(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff;
}

/**
 * Without a BOM, UTF-16 text has a very regular NUL pattern: ASCII characters
 * become `XX 00` (LE) or `00 XX` (BE). Count NULs in each parity to pick a
 * byte order. Non-ASCII text still leaves many zero bytes, just less regularly.
 */
function detectBomlessUtf16(bytes: Uint8Array): "utf-16le" | "utf-16be" | null {
  const sampleLength = Math.min(bytes.length, 8192);
  if (sampleLength < 4) return null;

  let evenZeros = 0;
  let oddZeros = 0;
  for (let i = 0; i < sampleLength; i++) {
    if (bytes[i] !== 0) continue;
    if (i % 2 === 0) evenZeros += 1;
    else oddZeros += 1;
  }

  const zeroCount = evenZeros + oddZeros;
  if (zeroCount < sampleLength * 0.2) return null;

  if (evenZeros > oddZeros * 2) return "utf-16be";
  if (oddZeros > evenZeros * 2) return "utf-16le";
  return null;
}

function decodeWith(bytes: Uint8Array, encoding: TextEncoding): string {
  if (encoding === "utf-8") {
    return new TextDecoder("utf-8").decode(bytes);
  }
  if (encoding === "windows-1252") {
    return new TextDecoder("windows-1252").decode(bytes);
  }
  return new TextDecoder(encoding).decode(bytes);
}

function stripLeadingBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function looksBinary(text: string): boolean {
  if (!text) return false;
  let nulCount = 0;
  let controlCount = 0;
  let replacementCount = 0;

  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code === 0) nulCount += 1;
    else if (code === 0xfffd) replacementCount += 1;
    else if (code < 0x20 && char !== "\t" && char !== "\n" && char !== "\r" && char !== "\f") {
      controlCount += 1;
    }
  }

  if (nulCount > 0) return true;
  const threshold = Math.max(2, Math.floor(text.length * 0.02));
  return controlCount > threshold || replacementCount > threshold;
}

/** Rough "does this look like real prose?" score, biased toward Assamese. */
function textScore(text: string): number {
  let score = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x0980 && code <= 0x09ff) score += 10;
    else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) score += 2;
    else if (code >= 0x20 && code !== 0x7f) score += 1;
    else if (char === "\n" || char === "\r" || char === "\t") score += 1;
  }
  return score;
}

/**
 * Decode the common text encodings. Throws only for content that cannot be
 * decoded at all; callers should check `suspiciousBinary` before accepting an
 * upload.
 */
export function decodeTextBytes(bytes: Uint8Array): DecodedText {
  if (bytes.length === 0) {
    return { text: "", encoding: "utf-8", suspiciousBinary: false };
  }

  let text: string;
  let encoding: TextEncoding;

  if (hasUtf8Bom(bytes)) {
    encoding = "utf-8";
    text = decodeWith(bytes.subarray(3), encoding);
  } else if (hasUtf16LeBom(bytes)) {
    encoding = "utf-16le";
    text = decodeWith(bytes.subarray(2), encoding);
  } else if (hasUtf16BeBom(bytes)) {
    encoding = "utf-16be";
    text = decodeWith(bytes.subarray(2), encoding);
  } else {
    // Strict UTF-8 first: most corpora are UTF-8 without a BOM. NUL bytes are
    // valid UTF-8, so a successful decode is not enough — UTF-16LE ASCII text
    // also decodes "successfully" into NUL-separated characters.
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      encoding = "utf-8";
      if (text.includes("\u0000")) {
        const bomlessUtf16 = detectBomlessUtf16(bytes);
        if (bomlessUtf16) {
          encoding = bomlessUtf16;
          text = decodeWith(bytes, encoding);
        }
      }
    } catch {
      const bomlessUtf16 = detectBomlessUtf16(bytes);
      if (bomlessUtf16) {
        encoding = bomlessUtf16;
        text = decodeWith(bytes, encoding);
      } else {
        // Legacy single-byte text. Assamese cannot be represented here, but
        // this keeps old English/ANSI files uploadable.
        encoding = "windows-1252";
        text = decodeWith(bytes, encoding);

        // UTF-16 Assamese has few or no NUL bytes unless the text is mostly
        // ASCII, so the parity heuristic can miss a BOM-less file. If the
        // single-byte decode looks broken, try both UTF-16 byte orders and keep
        // the most prose-like result.
        if (looksBinary(text)) {
          const candidates = (["utf-16le", "utf-16be"] as const)
            .map((candidate) => ({
              encoding: candidate,
              text: decodeWith(bytes, candidate),
            }))
            .filter((candidate) => !looksBinary(candidate.text))
            .sort((a, b) => textScore(b.text) - textScore(a.text));

          const best = candidates[0];
          if (best) {
            encoding = best.encoding;
            text = best.text;
          }
        }
      }
    }
  }

  text = stripLeadingBom(text);
  return {
    text,
    encoding,
    suspiciousBinary: looksBinary(text),
  };
}
