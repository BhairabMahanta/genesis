import {
  deleteMentionsByDocument,
  listClustersByWorkspace,
  replaceDocumentContent,
  saveCluster,
  saveMention,
} from "../store/prisma.js";
import { parseConll2012 } from "./conll-parser.js";

/**
 * CoNLL-2012 import. Port of `ImportService.importConll2012` +
 * `ConllMentionImportListener`: persists parsed sentences/tokens, wipes
 * prior mentions on the document (re-import path), then persists one
 * cluster per CoNLL chain id (preserving the original number when free,
 * else the next free number with the original kept in the label) and one
 * mention per span.
 */

export interface ImportResult {
  sentenceCount: number;
  tokenCount: number;
}

const CLUSTER_COLORS = [
  "#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#06b6d4", "#84cc16",
];

function colorFor(conllId: number): string {
  return CLUSTER_COLORS[((conllId % CLUSTER_COLORS.length) + CLUSTER_COLORS.length) % CLUSTER_COLORS.length] as string;
}

export async function importConll2012(
  documentId: string,
  workspaceId: string,
  content: string,
): Promise<ImportResult> {
  if (content == null || content.trim() === "") {
    await replaceDocumentContent(documentId, [], []);
    await deleteMentionsByDocument(documentId);
    return { sentenceCount: 0, tokenCount: 0 };
  }

  const parsed = parseConll2012(content);
  const { sentenceCount, tokenCount } = await replaceDocumentContent(
    documentId,
    parsed.sentences,
    parsed.tokens,
  );

  // Wipe any prior mentions on this document (re-import path).
  await deleteMentionsByDocument(documentId);

  const spans = [...parsed.chains.values()].flat();
  if (spans.length > 0) {
    const usedNumbers = new Set(
      (await listClustersByWorkspace(workspaceId)).map((cluster) => cluster.clusterNumber),
    );
    let nextFree = usedNumbers.size === 0 ? 1 : Math.max(...usedNumbers) + 1;
    const clusterByConllId = new Map<number, string>();
    for (const span of spans) {
      if (!clusterByConllId.has(span.clusterId)) {
        let target = span.clusterId;
        if (usedNumbers.has(target)) target = nextFree++;
        usedNumbers.add(target);
        const row = await saveCluster({
          workspaceId,
          clusterNumber: target,
          label: `CoNLL #${span.clusterId}`,
          color: colorFor(span.clusterId),
        });
        clusterByConllId.set(span.clusterId, row.id);
      }
    }

    const bySentence = new Map<number, typeof parsed.tokens>();
    for (const token of parsed.tokens) {
      const list = bySentence.get(token.sentenceIndex) ?? [];
      list.push(token);
      bySentence.set(token.sentenceIndex, list);
    }

    for (const span of spans) {
      const clusterId = clusterByConllId.get(span.clusterId);
      if (!clusterId) continue;
      const sentToks = (bySentence.get(span.sentenceIndex) ?? []).filter(
        (token) =>
          token.tokenIndex >= span.startTokenIndex &&
          token.tokenIndex <= span.endTokenIndex,
      );
      const text = sentToks.map((token) => token.form).join(" ").slice(0, 2000);
      const first = sentToks.find((token) => token.tokenIndex === span.startTokenIndex);
      const last = [...sentToks]
        .reverse()
        .find((token) => token.tokenIndex === span.endTokenIndex);
      await saveMention({
        workspaceId,
        documentId,
        clusterId,
        sentenceIndex: span.sentenceIndex,
        startTokenIndex: span.startTokenIndex,
        endTokenIndex: span.endTokenIndex,
        globalStartIndex: first?.globalIndex ?? span.startTokenIndex,
        globalEndIndex: last?.globalIndex ?? span.endTokenIndex,
        text,
        mentionType: null,
      });
    }
  }

  return { sentenceCount, tokenCount };
}
