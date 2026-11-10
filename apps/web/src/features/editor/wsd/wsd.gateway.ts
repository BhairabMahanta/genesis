import 'server-only';

import { ApiResponse } from '@/server/contracts/common';
import { serverFetch } from '@/server/http';
import {
  AmbiguousWordMatch,
  CreateWsdSenseRequest,
  ImportSensesResult,
  PaginatedSenses,
  SenseSearchParams,
  WsdAnnotation,
  WsdRejection,
  WsdSense,
} from './wsd.contracts';

export async function listSenses(
  workspaceId: string,
  word?: string,
): Promise<WsdSense[]> {
  const qs = word ? `?word=${encodeURIComponent(word)}` : '';
  const res = await serverFetch<ApiResponse<WsdSense[]>>(
    `/api/workspaces/${workspaceId}/wsd/senses${qs}`,
  );
  return res.data;
}

export async function searchSenses(
  workspaceId: string,
  params: SenseSearchParams,
): Promise<PaginatedSenses> {
  const q = new URLSearchParams();
  if (params.word) q.set('word', params.word);
  if (params.query) q.set('query', params.query);
  if (params.page !== undefined) q.set('page', String(params.page));
  if (params.limit !== undefined) q.set('limit', String(params.limit));
  const res = await serverFetch<ApiResponse<PaginatedSenses>>(
    `/api/workspaces/${workspaceId}/wsd/senses?${q.toString()}`,
  );
  return res.data;
}

export async function importSenses(
  workspaceId: string,
  formData: FormData,
): Promise<ImportSensesResult> {
  const res = await serverFetch<ApiResponse<ImportSensesResult>>(
    `/api/workspaces/${workspaceId}/wsd/import`,
    { method: 'POST', body: formData },
  );
  return res.data;
}

export async function getAnnotationsForToken(
  workspaceId: string,
  tokenId: string,
): Promise<WsdAnnotation[]> {
  const res = await serverFetch<ApiResponse<WsdAnnotation[]>>(
    `/api/workspaces/${workspaceId}/wsd/tokens/${tokenId}/annotations`,
  );
  return res.data;
}

export async function getAnnotationsForDocument(
  workspaceId: string,
  documentId: string,
): Promise<WsdAnnotation[]> {
  const res = await serverFetch<ApiResponse<WsdAnnotation[]>>(
    `/api/workspaces/${workspaceId}/wsd/documents/${documentId}/annotations`,
  );
  return res.data;
}

export async function deleteAnnotation(
  workspaceId: string,
  annotationId: string,
): Promise<void> {
  await serverFetch<ApiResponse<void>>(
    `/api/workspaces/${workspaceId}/wsd/annotations/${annotationId}`,
    { method: 'DELETE' },
  );
}

export async function upsertAnnotation(
  workspaceId: string,
  tokenId: string,
  senseId: string,
): Promise<WsdAnnotation> {
  const res = await serverFetch<ApiResponse<WsdAnnotation>>(
    `/api/workspaces/${workspaceId}/wsd/annotations`,
    { method: 'POST', body: JSON.stringify({ tokenId, senseId }) },
  );
  return res.data;
}

export async function createSense(
  workspaceId: string,
  request: CreateWsdSenseRequest,
): Promise<WsdSense> {
  const res = await serverFetch<ApiResponse<WsdSense>>(
    `/api/workspaces/${workspaceId}/wsd/senses`,
    { method: 'POST', body: JSON.stringify(request) },
  );
  return res.data;
}

export async function updateSense(
  workspaceId: string,
  senseId: string,
  request: CreateWsdSenseRequest,
): Promise<WsdSense> {
  const res = await serverFetch<ApiResponse<WsdSense>>(
    `/api/workspaces/${workspaceId}/wsd/senses/${senseId}`,
    { method: 'PUT', body: JSON.stringify(request) },
  );
  return res.data;
}

export async function deleteSense(
  workspaceId: string,
  senseId: string,
): Promise<void> {
  await serverFetch<ApiResponse<void>>(
    `/api/workspaces/${workspaceId}/wsd/senses/${senseId}`,
    { method: 'DELETE' },
  );
}

export async function matchAmbiguousWords(
  workspaceId: string,
  forms: string[],
): Promise<AmbiguousWordMatch[]> {
  const res = await serverFetch<ApiResponse<AmbiguousWordMatch[]>>(
    `/api/workspaces/${workspaceId}/wsd/words/match`,
    { method: 'POST', body: JSON.stringify({ forms }) },
  );
  return res.data;
}

export async function listRejectionsForDocument(
  workspaceId: string,
  documentId: string,
): Promise<WsdRejection[]> {
  const res = await serverFetch<ApiResponse<WsdRejection[]>>(
    `/api/workspaces/${workspaceId}/wsd/documents/${documentId}/rejections`,
  );
  return res.data;
}

export async function rejectSense(
  workspaceId: string,
  tokenId: string,
  senseId: string,
): Promise<void> {
  await serverFetch<ApiResponse<void>>(`/api/workspaces/${workspaceId}/wsd/rejections`, {
    method: 'POST',
    body: JSON.stringify({ tokenId, senseId }),
  });
}

export async function unrejectSense(
  workspaceId: string,
  tokenId: string,
  senseId: string,
): Promise<void> {
  await serverFetch<ApiResponse<void>>(
    `/api/workspaces/${workspaceId}/wsd/rejections/${tokenId}/${senseId}`,
    { method: 'DELETE' },
  );
}
