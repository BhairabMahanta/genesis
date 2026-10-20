import { z } from "zod";

export const createNerTagSchema = z.object({
  tag: z.string().min(1).max(20),
  description: z.string().max(200).nullish(),
  scope: z.enum(["GLOBAL", "WORKSPACE"]).default("GLOBAL"),
  workspaceId: z.string().uuid().nullish(),
});

export type CreateNerTagInput = z.infer<typeof createNerTagSchema>;

export const createNerAnnotationSchema = z.object({
  documentId: z.string().uuid(),
  startTokenIndex: z.number().int().min(0),
  endTokenIndex: z.number().int().min(0),
  label: z.string().min(1).max(20),
});

export type CreateNerAnnotationInput = z.infer<typeof createNerAnnotationSchema>;

export const updateNerAnnotationSchema = z.object({
  startTokenIndex: z.number().int().min(0).optional(),
  endTokenIndex: z.number().int().min(0).optional(),
  label: z.string().min(1).max(20).optional(),
});

export type UpdateNerAnnotationInput = z.infer<typeof updateNerAnnotationSchema>;

export interface NerTagDefinitionDto {
  id: string | null;
  tag: string;
  description: string | null;
  scope: "GLOBAL" | "WORKSPACE";
  workspaceId: string | null;
  builtin: boolean;
}

export interface NerAnnotationDto {
  id: string;
  documentId: string;
  startTokenIndex: number;
  endTokenIndex: number;
  label: string;
  annotatorId: string;
  timestamp: string;
}
