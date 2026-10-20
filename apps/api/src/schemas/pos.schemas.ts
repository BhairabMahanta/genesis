import { z } from "zod";

export const createPosTagSchema = z.object({
  tag: z.string().min(1).max(20),
  description: z.string().max(500).nullish(),
  scope: z.enum(["GLOBAL", "WORKSPACE"]).default("GLOBAL"),
  workspaceId: z.string().uuid().nullish(),
});

export type CreatePosTagInput = z.infer<typeof createPosTagSchema>;

export const updatePosSchema = z.object({
  pos: z.string().min(1).max(20).nullable(),
});

export const batchUpdatePosSchema = z.object({
  updates: z.array(z.object({ tokenId: z.string().uuid(), pos: z.string().min(1).max(20).nullable() })).min(1).max(500),
});

export interface PosAnnotationDto {
  id: string;
  tokenId: string;
  annotatorId: string;
  posTag: string;
  timestamp: string;
}

export interface PosTagDefinitionDto {
  id: string | null;
  tag: string;
  description: string | null;
  scope: "GLOBAL" | "WORKSPACE";
  workspaceId: string | null;
  builtin: boolean;
}
