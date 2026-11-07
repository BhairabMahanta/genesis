import { z } from "zod";

export const createSenseSchema = z.object({
  word: z.string().min(1).max(200),
  senseLabel: z.string().min(1).max(200),
  gloss: z.string().max(4000).nullish(),
  examples: z.string().max(4000).nullish(),
});

export type CreateSenseInput = z.infer<typeof createSenseSchema>;

export const createWsdAnnotationSchema = z.object({
  tokenId: z.string().uuid(),
  senseId: z.string().uuid(),
  documentId: z.string().uuid().nullish(),
});

export const rejectSenseSchema = z.object({
  tokenId: z.string().uuid(),
  senseId: z.string().uuid(),
});

export type RejectSenseInput = z.infer<typeof rejectSenseSchema>;

export type CreateWsdAnnotationInput = z.infer<typeof createWsdAnnotationSchema>;

export const matchWordsSchema = z.object({
  forms: z.array(z.string().min(1).max(200)).max(5000),
});

export interface AmbiguousWordMatchDto {
  word: string;
  senseCount: number;
}

export interface WsdSenseDto {
  id: string;
  workspaceId: string;
  word: string;
  senseLabel: string;
  gloss: string | null;
  examples: string | null;
}

export interface WsdAnnotationDto {
  id: string;
  tokenId: string;
  senseId: string;
  senseLabel?: string | null;
  /** Document-level fetch only: the annotated token's surface form and sentence, for the editor's work log. */
  tokenForm?: string | null;
  sentenceIndex?: number | null;
  annotatorId: string;
  workspaceId: string;
  timestamp: string;
}
