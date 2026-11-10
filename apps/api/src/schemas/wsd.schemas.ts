import { z } from "zod";

export const createSenseSchema = z.object({
  word: z.string().trim().min(1).max(200),
  senseLabel: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullish(),
});

export type CreateSenseInput = z.infer<typeof createSenseSchema>;

export const createWsdAnnotationSchema = z.object({
  tokenId: z.string().uuid(),
  senseId: z.string().uuid(),
  documentId: z.string().uuid().nullish(),
});

export type CreateWsdAnnotationInput = z.infer<typeof createWsdAnnotationSchema>;

/**
 * Inline sense creation from the editor. The word is derived from the token
 * server-side, so the client only supplies the sense text.
 */
export const createSenseWithAnnotationSchema = z.object({
  tokenId: z.string().uuid(),
  senseLabel: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullish(),
});

export type CreateSenseWithAnnotationInput = z.infer<
  typeof createSenseWithAnnotationSchema
>;

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
