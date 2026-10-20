import { NotFoundException } from "../common/errors.js";
import {
  deleteEditorSession,
  findDocumentById,
  findWorkspaceById,
  getEditorSession,
  listDocumentsByWorkspace,
  listPosByDocument,
  listSentences,
  listTokens,
  saveEditorSession,
} from "../store/prisma.js";
import { requireMember } from "./workspace.service.js";
import type {
  DocumentContentResponse,
  EditorDocumentInfo,
  EditorSessionResponse,
  SaveSessionInput,
} from "../schemas/editor.schemas.js";

async function toInfo(documentId: string): Promise<EditorDocumentInfo> {
  const doc = await findDocumentById(documentId);
  if (!doc) throw new NotFoundException("Document not found");
  const tokens = await listTokens(documentId);
  const sentences = await listSentences(documentId);
  return {
    id: doc.id,
    name: doc.name,
    orderIndex: doc.orderIndex,
    tokenCount: tokens.length,
    sentenceCount: sentences.length,
    status: doc.status,
    isTokenized: doc.processingStatus === "COMPLETED",
  };
}

export async function workspaceDocuments(
  workspaceId: string,
  userId: string,
): Promise<EditorDocumentInfo[]> {
  await requireMember(workspaceId, userId);
  const documents = await listDocumentsByWorkspace(workspaceId);
  return Promise.all(documents.map((doc) => toInfo(doc.id)));
}

export async function documentContent(
  workspaceId: string | null,
  documentId: string,
  userId: string | null,
  page = 0,
  size = 50,
): Promise<DocumentContentResponse> {
  const doc = await findDocumentById(documentId);
  if (!doc) throw new NotFoundException("Document not found");
  const wsId = workspaceId ?? doc.workspaceId;
  if (userId) await requireMember(wsId, userId);

  // Workspace-level global offset: sum of token counts of previous docs.
  let globalTokenOffset = 0;
  if (workspaceId) {
    const documents = await listDocumentsByWorkspace(workspaceId);
    for (const document of documents) {
      if (document.orderIndex < doc.orderIndex) {
        globalTokenOffset += (await listTokens(document.id)).length;
      }
    }
  }

  const sentences = await listSentences(documentId);
  const tokens = await listTokens(documentId);
  const posRows = await listPosByDocument(documentId);
  const posByToken = new Map(posRows.map((a) => [a.tokenId, a.posTag] as const));
  const safePage = Math.max(0, page);
  const safeSize = Math.min(Math.max(1, size), 500);
  const totalPages = Math.max(1, Math.ceil(sentences.length / safeSize));
  const pageSentences = sentences.slice(safePage * safeSize, safePage * safeSize + safeSize);

  const tokenBySentence = new Map<number, typeof tokens>();
  for (const token of tokens) {
    const list = tokenBySentence.get(token.sentenceIndex) ?? [];
    list.push(token);
    tokenBySentence.set(token.sentenceIndex, list);
  }
  const sentenceDtos = pageSentences.map((sentence) => {
    const sentenceTokens = (tokenBySentence.get(sentence.sentenceIndex) ?? []).sort(
      (a, b) => a.tokenIndex - b.tokenIndex,
    );
    return {
      sentenceIndex: sentence.sentenceIndex,
      startTokenIndex: sentenceTokens[0]?.tokenIndex ?? 0,
      endTokenIndex:
        sentenceTokens.length > 0
          ? (sentenceTokens[sentenceTokens.length - 1]?.tokenIndex ?? 0)
          : 0,
      tokens: sentenceTokens.map((token) => ({
        id: token.id,
        documentId: token.documentId,
        tokenIndex: token.tokenIndex,
        sentenceIndex: token.sentenceIndex,
        globalIndex: token.globalIndex,
        form: token.form,
        pos: posByToken.get(token.id) ?? token.pos,
        lemma: token.lemma,
        nerTag: token.nerTag,
        startOffset: token.startOffset,
        endOffset: token.endOffset,
      })),
    };
  });

  return {
    documentId: doc.id,
    documentName: doc.name,
    orderIndex: doc.orderIndex,
    sentences: sentenceDtos,
    tokens: sentenceDtos.flatMap((s) => s.tokens),
    totalSentences: sentences.length,
    totalTokens: tokens.length,
    globalTokenOffset,
    currentPage: safePage,
    totalPages,
    pageSize: safeSize,
  };
}

export async function openWorkspace(workspaceId: string, userId: string) {
  await requireMember(workspaceId, userId);
  const ws = await findWorkspaceById(workspaceId);
  if (!ws) throw new NotFoundException("Workspace not found");
  const docs = await workspaceDocuments(workspaceId, userId);
  const session = (await getEditorSession(workspaceId, userId)) ?? null;
  const totalTokens = docs.reduce((n, d) => n + d.tokenCount, 0);
  const totalSentences = docs.reduce((n, d) => n + d.sentenceCount, 0);
  return {
    workspaceId: ws.id,
    workspaceName: ws.name,
    annotationType: ws.annotationType,
    documents: docs,
    session: session
      ? {
          id: session.id,
          workspaceId,
          userId,
          lastDocumentIndex: session.lastDocumentIndex,
          scrollPosition: session.scrollPosition,
        }
      : null,
    totalDocuments: docs.length,
    totalTokens,
    totalSentences,
  };
}

export async function getSession(
  workspaceId: string,
  userId: string,
): Promise<EditorSessionResponse | null> {
  await requireMember(workspaceId, userId);
  const session = await getEditorSession(workspaceId, userId);
  if (!session) return null;
  return {
    id: session.id,
    workspaceId,
    userId,
    lastDocumentIndex: session.lastDocumentIndex,
    scrollPosition: session.scrollPosition,
  };
}

export async function saveSession(
  userId: string,
  input: SaveSessionInput,
): Promise<EditorSessionResponse> {
  await requireMember(input.workspaceId, userId);
  const session = await saveEditorSession({ ...input, userId });
  return {
    id: session.id,
    workspaceId: session.workspaceId,
    userId,
    lastDocumentIndex: session.lastDocumentIndex,
    scrollPosition: session.scrollPosition,
  };
}

export async function closeSession(workspaceId: string, userId: string): Promise<void> {
  await deleteEditorSession(workspaceId, userId);
}

export async function workspaceStatus(workspaceId: string, userId: string) {
  await requireMember(workspaceId, userId);
  const docs = await listDocumentsByWorkspace(workspaceId);
  const tokenized = docs.filter((d) => d.processingStatus === "COMPLETED");
  let totalTokens = 0;
  let totalSentences = 0;
  for (const doc of docs) {
    totalTokens += (await listTokens(doc.id)).length;
    totalSentences += (await listSentences(doc.id)).length;
  }
  return {
    workspaceId,
    totalDocuments: docs.length,
    tokenizedDocuments: tokenized.length,
    totalTokens,
    totalSentences,
    ready: docs.length > 0 && tokenized.length === docs.length,
  };
}
