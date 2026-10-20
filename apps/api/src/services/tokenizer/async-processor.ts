import { config } from "../../config.js";
import {
  deleteStoredFile,
  findDocumentById,
  findStoredFileById,
  listDocumentsByWorkspace,
  listTokens,
  notifyWorkspaceMembers,
  replaceDocumentContent,
  updateDocumentEntity,
} from "../../store/prisma.js";
import { getStorage } from "../storage/index.js";
import { importConll2012 } from "../import.service.js";
import { segment } from "./sentence-segmenter.js";
import { tokenize } from "./unicode-tokenizer.js";

/**
 * Async document processor. Port of `AsyncDocumentProcessor.java` +
 * `ImportService` (plain-text and CoNLL-2012 paths): downloads the stored
 * content, segments/tokenizes (or parses CoNLL, persisting mention spans
 * and clusters via `importConll2012`), replaces `sentences`/`tokens` rows
 * for the document in one step, and flips `processing_status`
 * PENDING → PROCESSING → COMPLETED (or FAILED with a truncated message).
 *
 * Completion also assigns the workspace-continuous token range
 * (`ContinuousTokenizationService`), reclaims the raw source file when
 * `STORAGE_RETAIN_SOURCE=false` (`DocumentSourceRetentionListener`), and
 * fans out a notification (`DocumentTokenizedEvent` listener).
 *
 * Runs fire-and-forget via `setImmediate` (the small-team stand-in for
 * Spring `@Async`).
 */

export interface UploadedDocumentEvent {
  documentId: string;
  workspaceId: string;
  storedFileUrl: string;
  fileName: string;
}

export function isConllFile(fileName: string | null, content: string | null): boolean {
  if (fileName) {
    const lower = fileName.toLowerCase();
    if (lower.endsWith(".conll") || lower.endsWith(".conll2012")) return true;
  }
  if (content) {
    let i = 0;
    while (i < content.length && /\s/u.test(content[i] as string)) i++;
    if (content.startsWith("#begin document", i)) return true;
  }
  return false;
}

function truncateError(message: unknown): string {
  const text = message instanceof Error ? message.message : String(message ?? "Unknown error");
  const clean = text === "" ? "Unknown error" : text;
  return clean.length > 900 ? `${clean.slice(0, 900)}...` : clean;
}

/**
 * Workspace-continuous token offset: total tokens of lower-ordered
 * documents in the same workspace (port of `ContinuousTokenizationService`).
 */
async function workspaceTokenOffset(workspaceId: string, documentId: string): Promise<number> {
  const current = await findDocumentById(documentId);
  let offset = 0;
  for (const document of await listDocumentsByWorkspace(workspaceId)) {
    if (
      document.id !== documentId &&
      (current == null || document.orderIndex < current.orderIndex)
    ) {
      offset += (await listTokens(document.id)).length;
    }
  }
  return offset;
}

export async function processDocument(event: UploadedDocumentEvent): Promise<void> {
  await updateDocumentEntity(event.documentId, {
    processingStatus: "PROCESSING",
    processingError: null,
  });

  const storage = getStorage();
  const content = await storage.downloadAsString(event.storedFileUrl);

  let tokenCount = 0;
  if (isConllFile(event.fileName, content)) {
    const result = await importConll2012(event.documentId, event.workspaceId, content ?? "");
    tokenCount = result.tokenCount;
  } else if (content === null || content.trim() === "") {
    await replaceDocumentContent(event.documentId, [], []);
  } else {
    const sentenceResults = segment(content);
    const sentenceRows: {
      sentenceIndex: number;
      text: string;
      startOffset: number;
      endOffset: number;
      tokenCount: number | null;
    }[] = [];
    const tokenRows: {
      sentenceIndex: number;
      tokenIndex: number;
      globalIndex: number;
      form: string;
      pos: string | null;
      lemma: string | null;
      nerTag: string | null;
      startOffset: number;
      endOffset: number;
    }[] = [];

    let globalIndex = 0;
    sentenceResults.forEach((sentence, sentenceIndex) => {
      const tokenResults = tokenize(sentence.text, sentence.startOffset);
      sentenceRows.push({
        sentenceIndex,
        text: sentence.text,
        startOffset: sentence.startOffset,
        endOffset: sentence.endOffset,
        tokenCount: tokenResults.length,
      });
      tokenResults.forEach((token, tokenIndex) => {
        tokenRows.push({
          sentenceIndex,
          tokenIndex,
          globalIndex: globalIndex++,
          form: token.text,
          pos: null,
          lemma: null,
          nerTag: null,
          startOffset: token.startOffset,
          endOffset: token.endOffset,
        });
      });
    });

    await replaceDocumentContent(event.documentId, sentenceRows, tokenRows);
    tokenCount = tokenRows.length;
  }

  const rangeStart =
    tokenCount > 0 ? await workspaceTokenOffset(event.workspaceId, event.documentId) : null;
  await updateDocumentEntity(event.documentId, {
    processingStatus: "COMPLETED",
    processingError: null,
    tokenStartIndex: rangeStart,
    tokenEndIndex: rangeStart == null ? null : rangeStart + tokenCount - 1,
  });

  // Source retention: drop the raw file when the deployment opts out.
  if (!config.storageRetainSource) {
    try {
      const doc = await findDocumentById(event.documentId);
      const storedId = doc?.storedFileId;
      if (storedId) {
        const stored = await findStoredFileById(storedId);
        await updateDocumentEntity(event.documentId, { storedFileId: null });
        if (stored) {
          try {
            await getStorage().delete(stored.publicId);
          } catch (err) {
            console.warn(`Failed to delete reclaimed source file ${stored.publicId}:`, err);
          }
          await deleteStoredFile(stored.id);
        }
      }
    } catch (err) {
      console.warn(`Source retention failed for document ${event.documentId}:`, err);
    }
  }

  // Fan-out: mirrors the `DocumentTokenizedEvent` listener.
  const doc = await findDocumentById(event.documentId);
  if (doc) {
    await notifyWorkspaceMembers(doc.workspaceId, {
      title: "Document Processing Complete",
      message: `Document '${event.fileName}' has been tokenized and is ready.`,
      type: "SUCCESS",
      actorId: null,
      link: `/workspace/${doc.workspaceId}/editor`,
    });
  }
}

/** Fire-and-forget entry point called right after document upload. */
export function processDocumentAsync(event: UploadedDocumentEvent): void {
  setImmediate(() => {
    processDocument(event).catch(async (err: unknown) => {
      console.error(`Error processing document ${event.documentId}:`, err);
      await updateDocumentEntity(event.documentId, {
        processingStatus: "FAILED",
        processingError: truncateError(err),
      });
      const doc = await findDocumentById(event.documentId);
      if (doc) {
        await notifyWorkspaceMembers(doc.workspaceId, {
          title: "Document processing failed",
          message: `Document '${event.fileName}' failed to process.`,
          type: "ERROR",
        });
      }
    });
  });
}

export function storedFileContentType(fileName: string): string {
  if (fileName.toLowerCase().endsWith(".txt")) return "text/plain";
  if (fileName.toLowerCase().endsWith(".conll") || fileName.toLowerCase().endsWith(".conll2012")) {
    return "text/plain";
  }
  return "application/octet-stream";
}

export { findStoredFileById };
