'use server';

import { type ActionResult, toActionError } from '@/server/contracts/common';
import type {
  AmbiguousWordMatch,
  CreateWsdSenseRequest,
  ImportSensesResult,
  PaginatedSenses,
  SenseSearchParams,
  WsdAnnotation,
  WsdRejection,
  WsdSense,
} from './wsd.contracts';
import {
  createSense,
  deleteAnnotation,
  deleteSense,
  getAnnotationsForDocument,
  getAnnotationsForToken,
  importSenses,
  listRejectionsForDocument,
  listSenses,
  matchAmbiguousWords,
  rejectSense,
  unrejectSense,
  searchSenses,
  updateSense,
  upsertAnnotation,
} from './wsd.gateway';

export async function createSenseAction(
  workspaceId: string,
  request: CreateWsdSenseRequest,
): Promise<ActionResult<WsdSense>> {
  try {
    const sense = await createSense(workspaceId, request);
    return { ok: true, data: sense };
  } catch (err) {
    return toActionError(err, 'Failed to create sense.');
  }
}

export async function updateSenseAction(
  workspaceId: string,
  senseId: string,
  request: CreateWsdSenseRequest,
): Promise<ActionResult<WsdSense>> {
  try {
    const sense = await updateSense(workspaceId, senseId, request);
    return { ok: true, data: sense };
  } catch (err) {
    return toActionError(err, 'Failed to update sense.');
  }
}

export async function deleteSenseAction(
  workspaceId: string,
  senseId: string,
): Promise<ActionResult<void>> {
  try {
    await deleteSense(workspaceId, senseId);
    return { ok: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to delete sense.');
  }
}

export async function listSensesAction(
  workspaceId: string,
  word?: string,
): Promise<ActionResult<WsdSense[]>> {
  try {
    const data = await listSenses(workspaceId, word);
    return { ok: true, data };
  } catch (err) {
    return toActionError(err, 'Failed to load senses.');
  }
}

export async function searchSensesAction(
  workspaceId: string,
  params: SenseSearchParams,
): Promise<ActionResult<PaginatedSenses>> {
  try {
    const data = await searchSenses(workspaceId, params);
    return { ok: true, data };
  } catch (err) {
    return toActionError(err, 'Failed to search senses.');
  }
}

export async function importSensesAction(
  workspaceId: string,
  formData: FormData,
): Promise<ActionResult<ImportSensesResult>> {
  try {
    const data = await importSenses(workspaceId, formData);
    return { ok: true, data };
  } catch (err) {
    return toActionError(err, 'Failed to import senses. Workspace admin role is required.');
  }
}

export async function getAnnotationsForTokenAction(
  workspaceId: string,
  tokenId: string,
): Promise<ActionResult<WsdAnnotation[]>> {
  try {
    const data = await getAnnotationsForToken(workspaceId, tokenId);
    return { ok: true, data };
  } catch (err) {
    return toActionError(err, 'Failed to load token annotations.');
  }
}

export async function upsertAnnotationAction(
  workspaceId: string,
  tokenId: string,
  senseId: string,
): Promise<ActionResult<WsdAnnotation>> {
  try {
    const data = await upsertAnnotation(workspaceId, tokenId, senseId);
    return { ok: true, data };
  } catch (err) {
    return toActionError(err, 'Failed to tag token.');
  }
}

export async function listAnnotationsForDocumentAction(
  workspaceId: string,
  documentId: string,
): Promise<ActionResult<WsdAnnotation[]>> {
  try {
    const data = await getAnnotationsForDocument(workspaceId, documentId);
    return { ok: true, data };
  } catch (err) {
    return toActionError(err, 'Failed to load document annotations.');
  }
}

export async function deleteAnnotationAction(
  workspaceId: string,
  annotationId: string,
): Promise<ActionResult<void>> {
  try {
    await deleteAnnotation(workspaceId, annotationId);
    return { ok: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to remove annotation.');
  }
}

export async function matchAmbiguousWordsAction(
  workspaceId: string,
  forms: string[],
): Promise<ActionResult<AmbiguousWordMatch[]>> {
  try {
    const data = await matchAmbiguousWords(workspaceId, forms);
    return { ok: true, data };
  } catch (err) {
    return toActionError(err, 'Failed to match ambiguous words.');
  }
}

export async function listRejectionsForDocumentAction(
  workspaceId: string,
  documentId: string,
): Promise<ActionResult<WsdRejection[]>> {
  try {
    const data = await listRejectionsForDocument(workspaceId, documentId);
    return { ok: true, data };
  } catch (err) {
    return toActionError(err, 'Failed to load your rejected senses.');
  }
}

export async function rejectSenseAction(
  workspaceId: string,
  tokenId: string,
  senseId: string,
): Promise<ActionResult<void>> {
  try {
    await rejectSense(workspaceId, tokenId, senseId);
    return { ok: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to reject sense.');
  }
}

export async function unrejectSenseAction(
  workspaceId: string,
  tokenId: string,
  senseId: string,
): Promise<ActionResult<void>> {
  try {
    await unrejectSense(workspaceId, tokenId, senseId);
    return { ok: true, data: undefined };
  } catch (err) {
    return toActionError(err, 'Failed to undo rejection.');
  }
}
