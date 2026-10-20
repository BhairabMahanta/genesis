import { BadRequestException, NotFoundException } from "../common/errors.js";
import {
  deleteDocumentEntity,
  deleteStoredFile,
  findDocumentById,
  findStoredFileById,
  listDocumentsByWorkspace,
  maxOrderIndex,
  notifyWorkspaceMembers,
  saveDocument,
  saveStoredFile,
  sumMentionTokensByDocumentId,
  updateDocumentEntity,
} from "../store/prisma.js";
import type { DocumentEntity, DocumentStatus } from "../store/types.js";
import { requireAdmin, requireMember } from "./workspace.service.js";
import { getStorage } from "./storage/index.js";
import { processDocumentAsync, storedFileContentType } from "./tokenizer/async-processor.js";
import { displayName, notifyUser } from "./notification.service.js";
import type { DocumentResponse } from "../schemas/document.schemas.js";

/**
 * Document use-cases. Mirrors `DocumentService`:
 * - upload stores bytes via `StorageService`, links a `stored_files` row,
 *   assigns `orderIndex = MAX + 1`, and kicks off async tokenization
 * - delete removes the stored object first, then the DB rows
 */

const DOCUMENT_STATUSES: DocumentStatus[] = ["UPLOADED", "IMPORTED", "ANNOTATING", "COMPLETE"];

async function toDocumentResponse(doc: DocumentEntity): Promise<DocumentResponse> {
  const stored = doc.storedFileId ? await findStoredFileById(doc.storedFileId) : undefined;
  return {
    id: doc.id,
    name: doc.name,
    orderIndex: doc.orderIndex,
    status: doc.status,
    progress: doc.progress,
    workspaceId: doc.workspaceId,
    storedFileUrl: stored?.url ?? null,
    tokenStartIndex: doc.tokenStartIndex,
    tokenEndIndex: doc.tokenEndIndex,
    processingStatus: doc.processingStatus,
    processingError: doc.processingError,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    fileSize: doc.fileSize,
  };
}

export async function uploadDocument(
  workspaceId: string,
  userId: string,
  file: { bytes: Uint8Array; filename: string; contentType: string | null },
): Promise<DocumentResponse> {
  await requireMember(workspaceId, userId);

  const storage = getStorage();
  const folder = `workspaces/${workspaceId}/documents`;
  const stored = await storage.upload(
    file.bytes,
    file.filename,
    file.contentType ?? storedFileContentType(file.filename),
    folder,
  );
  const storedRow = await saveStoredFile({
    publicId: stored.publicId,
    url: stored.url,
    originalFilename: stored.originalFilename,
    contentType: stored.contentType,
    fileSize: stored.fileSize,
    folder: stored.folder,
  });

  const maxIndex = await maxOrderIndex(workspaceId);
  const doc = await saveDocument({
    name: file.filename,
    orderIndex: maxIndex === null ? 0 : maxIndex + 1,
    fileSize: stored.fileSize,
    status: "UPLOADED",
    processingStatus: "PENDING",
    processingError: null,
    progress: null,
    tokenStartIndex: null,
    tokenEndIndex: null,
    workspaceId,
    storedFileId: storedRow.id,
  });

  // Mirrors NotificationEventListener.handleDocumentUploaded.
  const actorName = await displayName(userId);
  const link = `/workspace/${workspaceId}`;
  await notifyUser({
    recipientId: userId,
    title: "Document Uploaded",
    message: `Document '${file.filename}' uploaded successfully.`,
    type: "SUCCESS",
    workspaceId,
    actorId: userId,
    link,
  });
  await notifyWorkspaceMembers(workspaceId, {
    title: "Document Uploaded",
    message: `Document '${file.filename}' uploaded by ${actorName}`,
    type: "INFO",
    actorId: userId,
    link,
    excludeUserIds: [userId],
  });

  // Fire-and-forget: mirrors the `DocumentUploadedEvent` async listener.
  processDocumentAsync({
    documentId: doc.id,
    workspaceId,
    storedFileUrl: storedRow.url,
    fileName: file.filename,
  });

  const created = await findDocumentById(doc.id);
  if (!created) throw new NotFoundException("Document not found");
  return toDocumentResponse(created);
}

export async function listWorkspaceDocuments(
  workspaceId: string,
  userId: string,
): Promise<DocumentResponse[]> {
  await requireMember(workspaceId, userId);
  const documents = await listDocumentsByWorkspace(workspaceId);
  return Promise.all(documents.map(toDocumentResponse));
}

export async function countWorkspaceDocuments(
  workspaceId: string,
  userId: string,
): Promise<number> {
  await requireMember(workspaceId, userId);
  return (await listDocumentsByWorkspace(workspaceId)).length;
}

async function documentWorkspaceOrThrow(
  documentId: string,
): Promise<{ workspaceId: string; doc: DocumentEntity }> {
  const doc = await findDocumentById(documentId);
  if (!doc) throw new NotFoundException("Document not found");
  return { workspaceId: doc.workspaceId, doc };
}

export async function getDocument(
  documentId: string,
  userId: string,
): Promise<DocumentResponse> {
  const { workspaceId, doc } = await documentWorkspaceOrThrow(documentId);
  await requireMember(workspaceId, userId);
  return toDocumentResponse(doc);
}

export async function updateDocumentStatus(
  documentId: string,
  userId: string,
  status: string,
): Promise<DocumentResponse> {
  if (!DOCUMENT_STATUSES.includes(status as DocumentStatus)) {
    throw new BadRequestException(
      "Invalid status. Expected UPLOADED, IMPORTED, ANNOTATING, or COMPLETE",
    );
  }
  const { workspaceId } = await documentWorkspaceOrThrow(documentId);
  await requireMember(workspaceId, userId);
  const updated = await updateDocumentEntity(documentId, { status: status as DocumentStatus });
  if (!updated) throw new NotFoundException("Document not found");
  if (status === "COMPLETE") {
    await notifyWorkspaceMembers(workspaceId, {
      title: "Annotation Complete",
      message: `Document '${updated.name}' has been marked as annotation complete.`,
      type: "SUCCESS",
      actorId: null,
      link: `/workspace/${workspaceId}`,
    });
  }
  return toDocumentResponse(updated);
}

export async function deleteDocument(documentId: string, userId: string): Promise<void> {
  const { workspaceId, doc } = await documentWorkspaceOrThrow(documentId);
  await requireAdmin(workspaceId, userId);
  let storedToDelete: Awaited<ReturnType<typeof findStoredFileById>>;
  if (doc.storedFileId) {
    storedToDelete = await findStoredFileById(doc.storedFileId);
    if (storedToDelete) {
      try {
        await getStorage().delete(storedToDelete.publicId);
      } catch (err) {
        console.warn(`Failed to delete stored file ${storedToDelete.publicId}:`, err);
      }
    }
  }
  // `documents.stored_file_id` is NO ACTION, so the document row must go
  // before its stored_files row.
  await deleteDocumentEntity(documentId);
  if (storedToDelete) {
    await deleteStoredFile(storedToDelete.id);
  }
  // Mirrors NotificationEventListener.handleDocumentDeleted.
  const actorName = await displayName(userId);
  const link = `/workspace/${workspaceId}`;
  await notifyUser({
    recipientId: userId,
    title: "Document Deleted",
    message: `Document '${doc.name}' deleted successfully.`,
    type: "SUCCESS",
    workspaceId,
    actorId: userId,
    link,
  });
  await notifyWorkspaceMembers(workspaceId, {
    title: "Document Deleted",
    message: `Document '${doc.name}' deleted by ${actorName}`,
    type: "WARNING",
    actorId: userId,
    link,
    excludeUserIds: [userId],
  });
}

/**
 * Port of `DocumentAnnotationProgressListener`: recomputes a document's
 * annotation status and progress when its mentions change (create, assign,
 * unassign — not delete). First annotation moves an untouched document into
 * ANNOTATING; progress = mention-covered tokens / total tokens, capped at 1.
 * Failures are logged, never thrown (the mention write already committed).
 */
export async function onMentionAnnotated(documentId: string): Promise<void> {
  try {
    const doc = await findDocumentById(documentId);
    if (!doc) return;
    if (doc.status === "UPLOADED" || doc.status === "IMPORTED") {
      await updateDocumentEntity(documentId, { status: "ANNOTATING" });
    }
    const start = doc.tokenStartIndex;
    const end = doc.tokenEndIndex;
    let progress = 0;
    if (start != null && end != null) {
      const total = end - start + 1;
      if (total > 0) {
        progress = (await sumMentionTokensByDocumentId(documentId)) / total;
        if (progress > 1) progress = 1;
      }
    }
    await updateDocumentEntity(documentId, { progress });
  } catch (err) {
    console.warn(`Failed to update document progress for ${documentId}:`, err);
  }
}
