import { z } from "zod";

export const saveSessionSchema = z.object({
  workspaceId: z.string().uuid(),
  lastDocumentIndex: z.number().int().min(0),
  scrollPosition: z.number().min(0),
});

export type SaveSessionInput = z.infer<typeof saveSessionSchema>;

export interface TokenDto {
  id: string;
  documentId: string;
  tokenIndex: number;
  sentenceIndex: number;
  globalIndex: number;
  form: string;
  pos: string | null;
  lemma: string | null;
  nerTag: string | null;
  startOffset: number;
  endOffset: number;
}

export interface SentenceDto {
  sentenceIndex: number;
  startTokenIndex: number;
  endTokenIndex: number;
  tokens: TokenDto[];
}

export interface DocumentContentResponse {
  documentId: string;
  documentName: string;
  orderIndex: number;
  sentences: SentenceDto[];
  tokens: TokenDto[];
  totalSentences: number;
  totalTokens: number;
  globalTokenOffset: number;
  currentPage?: number;
  totalPages?: number;
  pageSize?: number;
}

export interface EditorDocumentInfo {
  id: string;
  name: string;
  orderIndex: number;
  tokenCount: number;
  sentenceCount: number;
  status: string;
  isTokenized: boolean;
}

export interface EditorSessionResponse {
  id?: string;
  workspaceId: string;
  userId: string;
  lastDocumentIndex: number;
  scrollPosition: number;
}
