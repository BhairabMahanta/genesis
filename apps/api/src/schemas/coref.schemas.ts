import { z } from "zod";

export const createMentionSchema = z.object({
  documentId: z.string().uuid(),
  sentenceIndex: z.number().int().min(0),
  startTokenIndex: z.number().int().min(0),
  endTokenIndex: z.number().int().min(0),
  text: z.string().min(1).max(2000),
  mentionType: z.string().max(50).nullish(),
  clusterId: z.string().uuid().nullish(),
});

export type CreateMentionInput = z.infer<typeof createMentionSchema>;

export const createClusterSchema = z.object({
  label: z.string().max(255).nullish(),
  color: z.string().max(20).nullish(),
});

export type CreateClusterInput = z.infer<typeof createClusterSchema>;

export const mergeClustersSchema = z.object({
  sourceClusterIds: z.array(z.string().uuid()).min(1),
  targetClusterId: z.string().uuid(),
});

export type MergeClustersInput = z.infer<typeof mergeClustersSchema>;

export interface MentionDto {
  id: string;
  workspaceId: string;
  documentId: string;
  clusterId: string | null;
  clusterNumber: number | null;
  sentenceIndex: number;
  startTokenIndex: number;
  endTokenIndex: number;
  globalStartIndex: number;
  globalEndIndex: number;
  text: string;
  mentionType: string | null;
  clusterColor: string | null;
}

export interface ClusterDto {
  id: string;
  workspaceId: string;
  clusterNumber: number;
  label: string | null;
  representativeText: string | null;
  color: string;
  mentionCount: number;
}
