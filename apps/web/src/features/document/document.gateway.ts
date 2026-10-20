import 'server-only';

import { ApiResponse } from '@/server/contracts/common';
import { serverFetch } from '@/server/http';
import { DocumentResponse } from './document.contracts';

export async function listDocuments(workspaceId: string): Promise<DocumentResponse[]> {
  const res = await serverFetch<ApiResponse<DocumentResponse[]>>(
    `/api/workspaces/${workspaceId}/documents`,
  );
  return res.data;
}

export async function deleteDocument(id: string): Promise<void> {
  await serverFetch<void>(`/api/documents/${id}`, { method: 'DELETE' });
}

export async function updateDocumentStatus(
  id: string,
  status: string,
): Promise<DocumentResponse> {
  const res = await serverFetch<ApiResponse<DocumentResponse>>(
    `/api/documents/${id}/status?status=${status}`,
    { method: 'PUT' },
  );
  return res.data;
}

export async function uploadDocument(
  workspaceId: string,
  file: File,
): Promise<DocumentResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await serverFetch<ApiResponse<DocumentResponse>>(
    `/api/workspaces/${workspaceId}/documents`,
    { method: 'POST', body: formData },
  );
  return res.data;
}
