import { BadRequestException } from "../common/errors.js";

/**
 * Parser for CoNLL-2012 format files. Port of `Conll2012Parser.java`.
 *
 * Parses CoNLL-2012 text into sentence/token rows plus coreference chains.
 * Sentence boundaries come from blank lines and `tokenIndex == 0` rows;
 * coreference lives in the last column (`(N)` single-token, `(N` … `N)`
 * multi-token, `|`-separated multiples). Offsets accumulate in Unicode
 * code points exactly like the Java version.
 */

export interface MentionSpan {
  sentenceIndex: number;
  startTokenIndex: number;
  endTokenIndex: number;
  clusterId: number;
}

export interface ParsedSentence {
  sentenceIndex: number;
  text: string;
  startOffset: number;
  endOffset: number;
  tokenCount: number | null;
}

export interface ParsedToken {
  sentenceIndex: number;
  tokenIndex: number;
  globalIndex: number;
  form: string;
  pos: string | null;
  lemma: string | null;
  nerTag: string | null;
  startOffset: number;
  endOffset: number;
}

export interface ParseResult {
  documentName: string;
  sentences: ParsedSentence[];
  tokens: ParsedToken[];
  chains: Map<number, MentionSpan[]>;
}

const BEGIN_DOCUMENT = /#begin document \(([^)]+)\);?\s*part\s+(\d+)/;
const END_DOCUMENT = /#end document/;

function parseCoreference(
  coref: string,
  sentenceIndex: number,
  tokenIndex: number,
  openMentions: Map<number, number>,
  chains: Map<number, MentionSpan[]>,
): void {
  const annotations = coref.split("|");
  for (let annotation of annotations) {
    annotation = annotation.trim();
    if (annotation === "" || annotation === "-") continue;

    if (annotation.startsWith("(")) {
      let numPart = annotation.slice(1);
      const closes = numPart.endsWith(")");
      if (closes) numPart = numPart.slice(0, -1);
      const clusterId = Number(numPart);
      if (!Number.isInteger(clusterId)) {
        throw new BadRequestException(
          `Invalid coref annotation '${annotation}': cluster id must be an integer`,
        );
      }
      if (closes) {
        const list = chains.get(clusterId) ?? [];
        list.push({ sentenceIndex, startTokenIndex: tokenIndex, endTokenIndex: tokenIndex, clusterId });
        chains.set(clusterId, list);
      } else {
        openMentions.set(clusterId, tokenIndex);
      }
    } else if (annotation.endsWith(")")) {
      const numPart = annotation.slice(0, -1);
      const clusterId = Number(numPart);
      if (!Number.isInteger(clusterId)) {
        throw new BadRequestException(
          `Invalid coref annotation '${annotation}': cluster id must be an integer`,
        );
      }
      const startIndex = openMentions.get(clusterId);
      openMentions.delete(clusterId);
      if (startIndex !== undefined) {
        const list = chains.get(clusterId) ?? [];
        list.push({ sentenceIndex, startTokenIndex: startIndex, endTokenIndex: tokenIndex, clusterId });
        chains.set(clusterId, list);
      }
    }
  }
}

export function parseConll2012(content: string): ParseResult {
  const sentences: ParsedSentence[] = [];
  const tokens: ParsedToken[] = [];
  const chains = new Map<number, MentionSpan[]>();
  const openMentions = new Map<number, number>();

  let documentName = "unknown";
  let currentSentenceIndex = -1;
  let globalTokenIndex = 0;
  let currentCharOffset = 0;

  let currentSentenceTokens: ParsedToken[] = [];
  let currentSentenceText = "";

  const flushSentence = (): void => {
    if (currentSentenceTokens.length === 0) return;
    const first = currentSentenceTokens[0]!;
    const last = currentSentenceTokens[currentSentenceTokens.length - 1]!;
    sentences.push({
      sentenceIndex: currentSentenceIndex,
      text: currentSentenceText.trim(),
      startOffset: first.startOffset,
      endOffset: last.endOffset,
      tokenCount: currentSentenceTokens.length,
    });
    tokens.push(...currentSentenceTokens);
    currentSentenceTokens = [];
    currentSentenceText = "";
    openMentions.clear();
  };

  const lines = content.split(/\r?\n/);
  lines.forEach((line, idx) => {
    const lineNumber = idx + 1;
    if (line.trim() === "") {
      flushSentence();
      return;
    }
    const begin = BEGIN_DOCUMENT.exec(line);
    if (begin) {
      documentName = begin[1] as string;
      return;
    }
    if (END_DOCUMENT.test(line)) return;
    if (line.startsWith("#")) return;

    const columns = line.split(/\s+/);
    if (columns.length < 4) return; // invalid line — skipped like Java
    const col2 = Number(columns[1]);
    const tokenIndex = Number(columns[2]);
    if (!Number.isInteger(col2) || !Number.isInteger(tokenIndex)) {
      throw new BadRequestException(
        `Invalid CoNLL line ${lineNumber}: expected integer columns 2-3, got '${columns[1]}' / '${columns[2]}'`,
      );
    }
    const word = columns[3] as string;
    const pos = columns.length > 4 ? (columns[4] as string) : "-";
    // Column 10 (0-indexed) is NER in nested-paren form; the raw string is
    // persisted so export round-trips exactly.
    const ner = columns.length > 10 ? (columns[10] as string) : null;
    const coref = columns[columns.length - 1] as string;

    if (tokenIndex === 0) {
      flushSentence();
      currentSentenceIndex++;
    }

    const wordCodePoints = [...word].length;
    const startOffset = currentCharOffset;
    const endOffset = currentCharOffset + wordCodePoints;
    currentSentenceTokens.push({
      sentenceIndex: currentSentenceIndex,
      tokenIndex,
      globalIndex: globalTokenIndex,
      form: word,
      pos: pos === "-" ? null : pos,
      lemma: null,
      nerTag: ner != null && ner !== "-" ? ner : null,
      startOffset,
      endOffset,
    });

    if (currentSentenceText.length > 0) {
      currentSentenceText += " ";
      currentCharOffset++;
    }
    currentSentenceText += word;
    currentCharOffset = endOffset;

    if (coref !== "-" && coref !== "*") {
      parseCoreference(coref, currentSentenceIndex, tokenIndex, openMentions, chains);
    }

    globalTokenIndex++;
  });

  flushSentence();
  return { documentName, sentences, tokens, chains };
}
