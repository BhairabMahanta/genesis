'use server';

import { revalidatePath } from 'next/cache';
import { type ActionResult, toActionError } from '@/server/contracts/common';
import type { DocumentResponse } from './document.contracts';
import {
  deleteDocument,
  updateDocumentStatus,
  uploadDocument,
} from './document.gateway';

export async function deleteDocumentAction(
  workspaceId: string,
  documentId: string,
): Promise<ActionResult<void>> {
  try {
    await deleteDocument(documentId);
    revalidatePath(`/workspace/${workspaceId}`);
    return { ok: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to delete document');
  }
}

export async function updateDocumentStatusAction(
  documentId: string,
  status: string,
): Promise<ActionResult<DocumentResponse>> {
  try {
    const data = await updateDocumentStatus(documentId, status);
    return { ok: true, data };
  } catch (err) {
    return toActionError(err, 'Failed to update document status');
  }
}

export async function uploadDocumentAction(
  workspaceId: string,
  formData: FormData,
  options?: { revalidate?: boolean },
): Promise<ActionResult<DocumentResponse>> {
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return { ok: false, error: 'No file provided' };
  }
  try {
    const data = await uploadDocument(workspaceId, file);
    if (options?.revalidate !== false) {
      revalidatePath(`/workspace/${workspaceId}`);
    }
    return { ok: true, data };
  } catch (err) {
    return toActionError(err, 'Failed to upload document');
  }
}

/** Revalidate the workspace route once after a batch of uploads. */
export async function revalidateWorkspaceAction(workspaceId: string): Promise<void> {
  revalidatePath(`/workspace/${workspaceId}`);
}
