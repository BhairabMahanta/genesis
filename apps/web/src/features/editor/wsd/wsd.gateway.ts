import 'server-only';

import { ApiResponse } from '@/server/contracts/common';
import { serverFetch } from '@/server/http';
import {
  CreateSenseWithAnnotationRequest,
  CreateWsdSenseRequest,
  WsdAnnotation,
  WsdSense,
  WsdSenseImportSummary,
  WsdSenseWithAnnotation,
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

export async function importSenses(
  workspaceId: string,
  file: File,
): Promise<WsdSenseImportSummary> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await serverFetch<ApiResponse<WsdSenseImportSummary>>(
    `/api/workspaces/${workspaceId}/wsd/senses/import`,
    { method: 'POST', body: formData },
  );
  return res.data;
}

export async function createSenseAndAnnotate(
  workspaceId: string,
  request: CreateSenseWithAnnotationRequest,
): Promise<WsdSenseWithAnnotation> {
  const res = await serverFetch<ApiResponse<WsdSenseWithAnnotation>>(
    `/api/workspaces/${workspaceId}/wsd/annotations/with-sense`,
    { method: 'POST', body: JSON.stringify(request) },
  );
  return res.data;
}
