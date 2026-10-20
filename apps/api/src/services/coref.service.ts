import { BadRequestException, NotFoundException } from "../common/errors.js";
import { cursorPage } from "../common/cursor-page.js";
import {
  appendLog,
  corefStats,
  deleteCluster,
  deleteMention,
  findCluster,
  findDocumentById,
  findMention,
  listClustersByWorkspace,
  listMentionsByCluster,
  listMentionsByDocument,
  listMentionsByWorkspace,
  listTokens,
  listUnassignedMentions,
  mergeClusters,
  saveCluster,
  saveMention,
  updateCluster,
  updateMention,
} from "../store/prisma.js";
import { requireMember } from "./workspace.service.js";
import { onMentionAnnotated } from "./document.service.js";
import type {
  ClusterDto,
  CreateClusterInput,
  CreateMentionInput,
  MentionDto,
  MergeClustersInput,
} from "../schemas/coref.schemas.js";

async function toMentionDto(m: {
  id: string;
  workspaceId: string;
  documentId: string;
  clusterId: string | null;
  sentenceIndex: number;
  startTokenIndex: number;
  endTokenIndex: number;
  globalStartIndex: number;
  globalEndIndex: number;
  text: string;
  mentionType: string | null;
}): Promise<MentionDto> {
  const cluster = m.clusterId ? await findCluster(m.clusterId) : undefined;
  return {
    ...m,
    clusterNumber: cluster?.clusterNumber ?? null,
    clusterColor: cluster?.color ?? null,
  };
}

async function toClusterDto(c: {
  id: string;
  workspaceId: string;
  clusterNumber: number;
  label: string | null;
  color: string;
}): Promise<ClusterDto> {
  const mentions = await listMentionsByCluster(c.id);
  return {
    ...c,
    representativeText: mentions[0]?.text ?? null,
    mentionCount: mentions.length,
  };
}

export async function createMention(
  workspaceId: string,
  userId: string,
  input: CreateMentionInput,
): Promise<MentionDto> {
  await requireMember(workspaceId, userId);
  const doc = await findDocumentById(input.documentId);
  if (!doc || doc.workspaceId !== workspaceId) throw new NotFoundException("Document not found");
  if (input.endTokenIndex < input.startTokenIndex) {
    throw new BadRequestException("endTokenIndex must be >= startTokenIndex");
  }
  // Resolve global token indexes from stored tokens when available.
  const toks = await listTokens(input.documentId);
  const byIndex = new Map(toks.map((t) => [t.tokenIndex, t.globalIndex]));
  // Optional immediate assignment (mirrors CreateMentionRequest.clusterId).
  if (input.clusterId != null) {
    const target = await findCluster(input.clusterId);
    if (!target || target.workspaceId !== workspaceId) {
      throw new NotFoundException("Cluster not found");
    }
  }
  const row = await saveMention({
    workspaceId,
    documentId: input.documentId,
    clusterId: input.clusterId ?? null,
    sentenceIndex: input.sentenceIndex,
    startTokenIndex: input.startTokenIndex,
    endTokenIndex: input.endTokenIndex,
    globalStartIndex: byIndex.get(input.startTokenIndex) ?? input.startTokenIndex,
    globalEndIndex: byIndex.get(input.endTokenIndex) ?? input.endTokenIndex,
    text: input.text,
    mentionType: input.mentionType ?? null,
  });
  await appendLog({
    workspaceId,
    userId,
    actionType: "MENTION_CREATED",
    entityId: row.id,
    payloadJson: JSON.stringify({ documentId: row.documentId }),
  });
  await onMentionAnnotated(row.documentId);
  return toMentionDto(row);
}

export async function listMentionsCursor(
  workspaceId: string,
  userId: string,
  cursor?: string,
  limit = 100,
) {
  await requireMember(workspaceId, userId);
  const capped = Math.min(Math.max(limit, 1), 500);
  const all = await listMentionsByWorkspace(workspaceId);
  let start = 0;
  if (cursor) {
    const idx = all.findIndex((m) => m.id === cursor);
    start = idx === -1 ? 0 : idx + 1;
  }
  const slice = all.slice(start, start + capped);
  const next = start + capped < all.length ? (slice[slice.length - 1]?.id ?? null) : null;
  return cursorPage(await Promise.all(slice.map(toMentionDto)), next, capped);
}

export async function listDocumentMentions(
  documentId: string,
  userId: string,
): Promise<MentionDto[]> {
  const doc = await findDocumentById(documentId);
  if (!doc) throw new NotFoundException("Document not found");
  await requireMember(doc.workspaceId, userId);
  return Promise.all((await listMentionsByDocument(documentId)).map(toMentionDto));
}

export async function listUnassigned(
  workspaceId: string,
  userId: string,
): Promise<MentionDto[]> {
  await requireMember(workspaceId, userId);
  return Promise.all((await listUnassignedMentions(workspaceId)).map(toMentionDto));
}

export async function getMention(
  mentionId: string,
  userId: string,
): Promise<MentionDto> {
  const mention = await findMention(mentionId);
  if (!mention) throw new NotFoundException("Mention not found");
  await requireMember(mention.workspaceId, userId);
  return toMentionDto(mention);
}

export async function assignMention(
  mentionId: string,
  clusterId: string,
  userId: string,
): Promise<MentionDto> {
  const mention = await findMention(mentionId);
  if (!mention) throw new NotFoundException("Mention not found");
  const cluster = await findCluster(clusterId);
  if (!cluster || cluster.workspaceId !== mention.workspaceId) {
    throw new NotFoundException("Cluster not found");
  }
  await requireMember(mention.workspaceId, userId);
  const updated = await updateMention(mentionId, { clusterId });
  if (!updated) throw new NotFoundException("Mention not found");
  await appendLog({
    workspaceId: mention.workspaceId,
    userId,
    actionType: "MENTION_ASSIGNED",
    entityId: mentionId,
    payloadJson: JSON.stringify({ clusterId }),
  });
  await onMentionAnnotated(mention.documentId);
  return toMentionDto(updated);
}

export async function unassignMention(
  mentionId: string,
  userId: string,
): Promise<MentionDto> {
  const mention = await findMention(mentionId);
  if (!mention) throw new NotFoundException("Mention not found");
  await requireMember(mention.workspaceId, userId);
  const updated = await updateMention(mentionId, { clusterId: null });
  if (!updated) throw new NotFoundException("Mention not found");
  await onMentionAnnotated(mention.documentId);
  return toMentionDto(updated);
}

export async function removeMention(
  mentionId: string,
  userId: string,
): Promise<void> {
  const mention = await findMention(mentionId);
  if (!mention) throw new NotFoundException("Mention not found");
  await requireMember(mention.workspaceId, userId);
  await deleteMention(mentionId);
  await appendLog({
    workspaceId: mention.workspaceId,
    userId,
    actionType: "MENTION_DELETED",
    entityId: mentionId,
    payloadJson: null,
  });
}

export async function createCluster(
  workspaceId: string,
  userId: string,
  input: CreateClusterInput,
): Promise<ClusterDto> {
  await requireMember(workspaceId, userId);
  const row = await saveCluster({
    workspaceId,
    label: input.label ?? null,
    color: input.color ?? undefined,
  });
  await appendLog({
    workspaceId,
    userId,
    actionType: "CLUSTER_CREATED",
    entityId: row.id,
    payloadJson: null,
  });
  return toClusterDto(row);
}

export async function listClustersCursor(
  workspaceId: string,
  userId: string,
  cursor?: number,
  limit = 100,
) {
  await requireMember(workspaceId, userId);
  const capped = Math.min(Math.max(limit, 1), 500);
  const all = await listClustersByWorkspace(workspaceId);
  const filtered =
    cursor != null && !Number.isNaN(cursor)
      ? all.filter((cluster) => cluster.clusterNumber > cursor)
      : all;
  const slice = filtered.slice(0, capped);
  const next =
    filtered.length > capped
      ? String(slice[slice.length - 1]?.clusterNumber ?? "")
      : null;
  return cursorPage(await Promise.all(slice.map(toClusterDto)), next, capped);
}

export async function getCluster(
  clusterId: string,
  userId: string,
): Promise<ClusterDto> {
  const cluster = await findCluster(clusterId);
  if (!cluster) throw new NotFoundException("Cluster not found");
  await requireMember(cluster.workspaceId, userId);
  return toClusterDto(cluster);
}

export async function listClusterMentions(
  clusterId: string,
  userId: string,
): Promise<MentionDto[]> {
  const cluster = await findCluster(clusterId);
  if (!cluster) throw new NotFoundException("Cluster not found");
  await requireMember(cluster.workspaceId, userId);
  return Promise.all((await listMentionsByCluster(clusterId)).map(toMentionDto));
}

export async function renameCluster(
  clusterId: string,
  userId: string,
  input: CreateClusterInput,
): Promise<ClusterDto> {
  const cluster = await findCluster(clusterId);
  if (!cluster) throw new NotFoundException("Cluster not found");
  await requireMember(cluster.workspaceId, userId);
  const updated = await updateCluster(clusterId, {
    label: input.label ?? undefined,
    color: input.color ?? undefined,
  });
  if (!updated) throw new NotFoundException("Cluster not found");
  return toClusterDto(updated);
}

export async function removeCluster(
  clusterId: string,
  userId: string,
): Promise<void> {
  const cluster = await findCluster(clusterId);
  if (!cluster) throw new NotFoundException("Cluster not found");
  await requireMember(cluster.workspaceId, userId);
  await deleteCluster(clusterId);
}

export async function merge(
  workspaceId: string,
  userId: string,
  input: MergeClustersInput,
): Promise<ClusterDto> {
  await requireMember(workspaceId, userId);
  const target = await findCluster(input.targetClusterId);
  if (!target || target.workspaceId !== workspaceId) {
    throw new NotFoundException("Target cluster not found");
  }
  const sourceIds = input.sourceClusterIds.filter((id) => id !== input.targetClusterId);
  if (sourceIds.length === 0) {
    throw new BadRequestException("At least one source cluster is required");
  }
  for (const sourceId of sourceIds) {
    const source = await findCluster(sourceId);
    if (!source || source.workspaceId !== workspaceId) {
      throw new NotFoundException(`Source cluster not found: ${sourceId}`);
    }
  }
  const merged = await mergeClusters(workspaceId, sourceIds, input.targetClusterId);
  if (!merged) throw new NotFoundException("Target cluster not found");
  await appendLog({
    workspaceId,
    userId,
    actionType: "CLUSTER_MERGED",
    entityId: merged.id,
    payloadJson: JSON.stringify(input),
  });
  return toClusterDto(merged);
}

export async function stats(workspaceId: string, userId: string) {
  await requireMember(workspaceId, userId);
  return corefStats(workspaceId);
}
