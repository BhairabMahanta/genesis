import { z } from "zod";

export const createSenseSchema = z.object({
  word: z.string().min(1).max(255),
  senseLabel: z.string().min(1).max(255),
  description: z.string().max(2000).nullish(),
});

export type CreateSenseInput = z.infer<typeof createSenseSchema>;

export const createWsdAnnotationSchema = z.object({
  tokenId: z.string().uuid(),
  senseId: z.string().uuid(),
  documentId: z.string().uuid().nullish(),
});

export type CreateWsdAnnotationInput = z.infer<typeof createWsdAnnotationSchema>;

export interface WsdSenseDto {
  id: string;
  workspaceId: string;
  word: string;
  senseLabel: string;
  description: string | null;
}

export interface WsdAnnotationDto {
  id: string;
  tokenId: string;
  senseId: string;
  senseLabel?: string | null;
  annotatorId: string;
  workspaceId: string;
  timestamp: string;
}
