import {
  dismissRecommendation,
  isRecommendationDismissed,
  listClustersByWorkspace,
  listDocumentsByWorkspace,
  listMentionsByDocument,
  listMentionsByWorkspace,
  listTokens,
  listUnassignedMentions,
} from "../store/prisma.js";
import { requireMember } from "./workspace.service.js";
import { hashOf } from "./recommendation-hash.js";
import { isStopWord } from "./stop-words.js";

export interface RecommendationDto {
  hash: string;
  type: "UNFINISHED_MENTION" | "DENSITY_GAP" | "STRING_MATCH" | "COREF_CHAIN_GAP";
  priority: "HIGH" | "MEDIUM" | "LOW";
  documentId: string | null;
  entityId: string | null;
  tokenStartIndex: number | null;
  tokenEndIndex: number | null;
  reason: string;
}

/** Re-exported for tests + telemetry (mirrors the Java `util` package). */
export { hashOf };
export { isStopWord };

/** Rule 1 — mentions without a cluster assignment (HIGH). */
async function unfinishedMentions(workspaceId: string): Promise<RecommendationDto[]> {
  const out: RecommendationDto[] = [];
  for (const mention of await listUnassignedMentions(workspaceId)) {
    const label = mention.text == null ? "Mention" : `"${mention.text}"`;
    out.push({
      hash: hashOf("UNFINISHED_MENTION", mention.documentId, mention.id),
      type: "UNFINISHED_MENTION",
      priority: "HIGH",
      documentId: mention.documentId,
      entityId: mention.id,
      tokenStartIndex: mention.startTokenIndex,
      tokenEndIndex: mention.endTokenIndex,
      reason: `${label} has no cluster assignment.`,
    });
  }
  return out;
}

/** Rule 2 — one MEDIUM card per document with zero mentions. */
async function densityGaps(workspaceId: string): Promise<RecommendationDto[]> {
  const out: RecommendationDto[] = [];
  for (const doc of await listDocumentsByWorkspace(workspaceId)) {
    if ((await listMentionsByDocument(doc.id)).length !== 0) continue;
    const name = doc.name ?? "(untitled)";
    out.push({
      hash: hashOf("DENSITY_GAP", doc.id, doc.id),
      type: "DENSITY_GAP",
      priority: "MEDIUM",
      documentId: doc.id,
      entityId: doc.id,
      tokenStartIndex: null,
      tokenEndIndex: null,
      reason: `Document "${name}" has no annotations yet.`,
    });
  }
  return out;
}

/**
 * Rule 3 — STRING_MATCH. Workspace-wide repeated surface forms
 * (≥3 occurrences), stop-word filtered, capped at 50 cards (LOW).
 */
async function stringMatches(workspaceId: string): Promise<RecommendationDto[]> {
  const MIN_OCCURRENCES = 3;
  const MAX_CARDS = 50;
  const counts = new Map<string, number>();
  for (const doc of await listDocumentsByWorkspace(workspaceId)) {
    for (const token of await listTokens(doc.id)) {
      counts.set(token.form, (counts.get(token.form) ?? 0) + 1);
    }
  }
  const out: RecommendationDto[] = [];
  const ranked = [...counts.entries()]
    .filter(([form, n]) => n >= MIN_OCCURRENCES && !isStopWord(form))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [form, count] of ranked) {
    if (out.length >= MAX_CARDS) break;
    out.push({
      hash: hashOf("STRING_MATCH", null, form),
      type: "STRING_MATCH",
      priority: "LOW",
      documentId: null,
      entityId: null,
      tokenStartIndex: null,
      tokenEndIndex: null,
      reason: `"${form}" appears ${count} times — consider annotating.`,
    });
  }
  return out;
}

/**
 * Rule 4 — coreference chain gaps (MEDIUM). A cluster with mentions at
 * document order indices {1, 2, 4} skipped document 3 — flag it.
 * Workspace-wide card, hash entityId = clusterId.
 */
async function chainGaps(workspaceId: string): Promise<RecommendationDto[]> {
  const out: RecommendationDto[] = [];
  const documents = await listDocumentsByWorkspace(workspaceId);
  const orderByDocument = new Map(documents.map((doc) => [doc.id, doc.orderIndex]));
  const mentions = await listMentionsByWorkspace(workspaceId);
  for (const cluster of await listClustersByWorkspace(workspaceId)) {
    const orderIdx = new Set<number>();
    for (const mention of mentions) {
      if (mention.clusterId !== cluster.id) continue;
      const orderIndex = orderByDocument.get(mention.documentId);
      if (orderIndex !== undefined) orderIdx.add(orderIndex);
    }
    if (orderIdx.size === 0) continue;
    const min = Math.min(...orderIdx);
    const max = Math.max(...orderIdx);
    const missing = max - min + 1 - orderIdx.size;
    if (missing <= 0) continue;
    out.push({
      hash: hashOf("COREF_CHAIN_GAP", null, cluster.id),
      type: "COREF_CHAIN_GAP",
      priority: "MEDIUM",
      documentId: null,
      entityId: cluster.id,
      tokenStartIndex: null,
      tokenEndIndex: null,
      reason: `Cluster skips ${missing} document(s) in the chain — check for missed mentions.`,
    });
  }
  return out;
}

export async function listRecommendations(
  workspaceId: string,
  userId: string,
): Promise<RecommendationDto[]> {
  await requireMember(workspaceId, userId);
  const out = [
    ...(await unfinishedMentions(workspaceId)),
    ...(await densityGaps(workspaceId)),
    ...(await stringMatches(workspaceId)),
    ...(await chainGaps(workspaceId)),
  ];
  const dismissed = await Promise.all(
    out.map((recommendation) =>
      isRecommendationDismissed(workspaceId, userId, recommendation.hash),
    ),
  );
  return out.filter((_, index) => !dismissed[index]);
}

export async function dismiss(
  workspaceId: string,
  userId: string,
  hash: string,
  accepted: boolean,
): Promise<void> {
  await requireMember(workspaceId, userId);
  await dismissRecommendation({
    workspaceId,
    userId,
    recommendationHash: hash,
    accepted,
  });
}
