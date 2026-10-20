import 'server-only';

import { ApiResponse } from '@/server/contracts/common';
import { serverFetch } from '@/server/http';
import {
  AddMemberRequest,
  CreateWorkspaceRequest,
  MemberResponse,
  MemberRole,
  UpdateWorkspaceRequest,
  WorkspaceResponse,
} from './workspace.contracts';

/**
 * Server-side wrappers around the workspace endpoints. They read auth from
 * cookies via `serverFetch` and are safe to call from Server Components / Actions.
 */

export async function listWorkspaces(): Promise<WorkspaceResponse[]> {
  const res = await serverFetch<ApiResponse<WorkspaceResponse[]>>('/api/workspaces');
  return res.data;
}

export async function createWorkspace(
  request: CreateWorkspaceRequest,
): Promise<WorkspaceResponse> {
  const res = await serverFetch<ApiResponse<WorkspaceResponse>>('/api/workspaces', {
    method: 'POST',
    body: JSON.stringify(request),
  });
  return res.data;
}

export async function getWorkspaceById(id: string): Promise<WorkspaceResponse> {
  const res = await serverFetch<ApiResponse<WorkspaceResponse>>(`/api/workspaces/${id}`);
  return res.data;
}

export async function updateWorkspace(
  id: string,
  request: UpdateWorkspaceRequest,
): Promise<WorkspaceResponse> {
  const res = await serverFetch<ApiResponse<WorkspaceResponse>>(`/api/workspaces/${id}`, {
    method: 'PUT',
    body: JSON.stringify(request),
  });
  return res.data;
}

export async function deleteWorkspace(id: string): Promise<void> {
  await serverFetch<void>(`/api/workspaces/${id}`, { method: 'DELETE' });
}

export async function listMembers(id: string): Promise<MemberResponse[]> {
  const res = await serverFetch<ApiResponse<MemberResponse[]>>(`/api/workspaces/${id}/members`);
  return res.data;
}

export async function addMember(
  id: string,
  request: AddMemberRequest,
): Promise<void> {
  await serverFetch<void>(`/api/workspaces/${id}/members`, {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export async function removeMember(id: string, userId: string): Promise<void> {
  await serverFetch<void>(`/api/workspaces/${id}/members/${userId}`, {
    method: 'DELETE',
  });
}

export async function updateMemberRole(
  id: string,
  userId: string,
  role: MemberRole,
): Promise<void> {
  await serverFetch<void>(`/api/workspaces/${id}/members/${userId}?role=${role}`, {
    method: 'PUT',
  });
}
