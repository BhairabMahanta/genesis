import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "../common/errors.js";
import {
  deleteDocumentEntity,
  deleteMember,
  deleteStoredFile,
  deleteWorkspaceEntity,
  existsWorkspaceByNameAndOwnerId,
  findDocumentById,
  findMember,
  findStoredFileById,
  findUserByEmail,
  findUserById,
  findWorkspaceById,
  listDocumentsByWorkspace,
  listMembers,
  listWorkspacesForUser,
  notifyWorkspaceMembers,
  saveMember,
  saveWorkspace,
  updateMemberRole,
  updateWorkspaceEntity,
} from "../store/prisma.js";
import type {
  AnnotationType,
  MemberRole,
  WorkspaceStatus,
} from "../store/types.js";
import type {
  AddMemberInput,
  CreateWorkspaceInput,
  MemberResponse,
  UpdateWorkspaceInput,
  WorkspaceResponse,
} from "../schemas/workspace.schemas.js";
import { displayName, notifyUser } from "./notification.service.js";
import { getStorage } from "./storage/index.js";

/**
 * Workspace use-cases. Mirrors `WorkspaceService` + `WorkspaceAccessControl`:
 * - creator becomes ADMIN; `requireMember` → 401, `requireAdmin` → 403
 * - owner row is immutable (cannot remove / demote the owner)
 * - `WorkspaceResponse` carries live document counts and progress
 */

export async function requireMember(workspaceId: string, userId: string): Promise<void> {
  if (!(await findMember(workspaceId, userId))) {
    throw new UnauthorizedException("You are not a member of this workspace");
  }
}

export async function requireAdmin(workspaceId: string, userId: string): Promise<void> {
  const membership = await findMember(workspaceId, userId);
  if (!membership) {
    throw new UnauthorizedException("You are not a member of this workspace");
  }
  if (membership.role !== "ADMIN") {
    throw new ForbiddenException("Admin role required");
  }
}

async function toWorkspaceResponse(workspaceId: string): Promise<WorkspaceResponse> {
  const ws = await findWorkspaceById(workspaceId);
  if (!ws) throw new NotFoundException("Workspace not found");
  const owner = await findUserById(ws.ownerId);
  const docs = await listDocumentsByWorkspace(workspaceId);
  const annotated = docs.filter((d) => d.status === "COMPLETE").length;
  const total = docs.length;
  return {
    id: ws.id,
    name: ws.name,
    description: ws.description,
    annotationType: ws.annotationType,
    status: ws.status,
    ownerId: ws.ownerId,
    ownerUsername: owner?.username ?? "",
    documentCount: total,
    annotatedDocumentCount: annotated,
    progressPercentage: total === 0 ? 0 : Math.round((annotated * 100) / total),
    createdAt: ws.createdAt,
    updatedAt: ws.updatedAt,
  };
}

export async function createWorkspace(
  userId: string,
  input: CreateWorkspaceInput,
): Promise<WorkspaceResponse> {
  if (await existsWorkspaceByNameAndOwnerId(input.name, userId)) {
    throw new BadRequestException("A workspace with this name already exists");
  }
  const ws = await saveWorkspace({
    name: input.name,
    description: input.description ?? null,
    annotationType: input.annotationType as AnnotationType,
    status: "DRAFT",
    ownerId: userId,
  });
  await saveMember({ workspaceId: ws.id, userId, role: "ADMIN" });
  // Mirrors NotificationEventListener.handleWorkspaceCreated.
  await notifyUser({
    recipientId: userId,
    title: "Workspace Created",
    message: `Workspace '${ws.name}' created successfully.`,
    type: "SUCCESS",
    workspaceId: ws.id,
    actorId: userId,
    link: `/workspace/${ws.id}`,
  });
  return toWorkspaceResponse(ws.id);
}

export async function listWorkspaces(userId: string): Promise<WorkspaceResponse[]> {
  const workspaces = await listWorkspacesForUser(userId);
  return Promise.all(workspaces.map((ws) => toWorkspaceResponse(ws.id)));
}

export async function getWorkspace(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceResponse> {
  await requireMember(workspaceId, userId);
  return toWorkspaceResponse(workspaceId);
}

export async function updateWorkspace(
  workspaceId: string,
  userId: string,
  input: UpdateWorkspaceInput,
): Promise<WorkspaceResponse> {
  await requireAdmin(workspaceId, userId);
  const patch: { name?: string; description?: string | null } = {};
  if (input.name !== undefined && input.name.trim() !== "") {
    patch.name = input.name;
  }
  if (input.description !== undefined) {
    patch.description = input.description;
  }
  const updated = await updateWorkspaceEntity(workspaceId, patch);
  if (!updated) throw new NotFoundException("Workspace not found");
  return toWorkspaceResponse(workspaceId);
}

export async function updateWorkspaceStatus(
  workspaceId: string,
  userId: string,
  status: WorkspaceStatus,
): Promise<WorkspaceResponse> {
  await requireAdmin(workspaceId, userId);
  const updated = await updateWorkspaceEntity(workspaceId, { status });
  if (!updated) throw new NotFoundException("Workspace not found");
  return toWorkspaceResponse(workspaceId);
}

export async function deleteWorkspace(workspaceId: string, userId: string): Promise<void> {
  await requireAdmin(workspaceId, userId);
  const workspace = await findWorkspaceById(workspaceId);
  if (!workspace) {
    throw new NotFoundException("Workspace not found");
  }
  const members = await listMembers(workspaceId);
  const documents = await listDocumentsByWorkspace(workspaceId);
  const actorName = await displayName(userId);

  // Java's WorkspaceService.delete delegates to DocumentService.delete for
  // every document, so stored objects are reclaimed and document-deleted
  // notifications fire before the workspace row disappears.
  for (const document of documents) {
    let stored: Awaited<ReturnType<typeof findStoredFileById>>;
    if (document.storedFileId) {
      stored = await findStoredFileById(document.storedFileId);
      if (stored) {
        try {
          await getStorage().delete(stored.publicId);
        } catch (err) {
          console.warn(`Failed to delete stored file ${stored.publicId}:`, err);
        }
      }
    }
    await deleteDocumentEntity(document.id);
    if (stored) await deleteStoredFile(stored.id);
    const link = `/workspace/${workspaceId}`;
    await notifyUser({
      recipientId: userId,
      title: "Document Deleted",
      message: `Document '${document.name}' deleted successfully.`,
      type: "SUCCESS",
      workspaceId,
      actorId: userId,
      link,
    });
    await notifyWorkspaceMembers(workspaceId, {
      title: "Document Deleted",
      message: `Document '${document.name}' deleted by ${actorName}`,
      type: "WARNING",
      actorId: userId,
      link,
      excludeUserIds: [userId],
    });
  }

  await deleteWorkspaceEntity(workspaceId);
  // Mirrors NotificationEventListener.handleWorkspaceDeleted: workspace is
  // gone, so these are workspace-less warnings pointing back to /home.
  for (const member of members) {
    await notifyUser({
      recipientId: member.userId,
      title: "Workspace Deleted",
      message: `Workspace '${workspace.name}' has been deleted.`,
      type: "WARNING",
      workspaceId: null,
      actorId: null,
      link: "/home",
    });
  }
}

export async function listWorkspaceMembers(
  workspaceId: string,
  userId: string,
): Promise<MemberResponse[]> {
  await requireMember(workspaceId, userId);
  const members = await listMembers(workspaceId);
  return Promise.all(
    members.map(async (member) => {
      const user = await findUserById(member.userId);
      if (!user) throw new NotFoundException("Member user not found");
      return {
        userId: user.id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: member.role,
      };
    }),
  );
}

export async function addWorkspaceMember(
  workspaceId: string,
  adminId: string,
  input: AddMemberInput,
): Promise<void> {
  await requireAdmin(workspaceId, adminId);
  const user = await findUserByEmail(input.email);
  if (!user) {
    throw new NotFoundException("User not found");
  }
  if (await findMember(workspaceId, user.id)) {
    throw new BadRequestException("User is already a member of this workspace");
  }
  await saveMember({ workspaceId, userId: user.id, role: input.role as MemberRole });
  const ws = await findWorkspaceById(workspaceId);
  if (!ws) throw new NotFoundException("Workspace not found");
  // Mirrors NotificationEventListener.handleMemberAdded.
  const actorName = await displayName(adminId);
  const newMemberName = await displayName(user.id);
  const link = `/workspace/${workspaceId}`;
  await notifyUser({
    recipientId: user.id,
    title: "Added to Workspace",
    message: `You have been added to workspace '${ws.name}' by ${actorName}.`,
    type: "SUCCESS",
    workspaceId,
    actorId: adminId,
    link,
  });
  await notifyUser({
    recipientId: adminId,
    title: "Member Added",
    message: `User ${newMemberName} added to workspace successfully.`,
    type: "SUCCESS",
    workspaceId,
    actorId: adminId,
    link,
  });
  await notifyWorkspaceMembers(workspaceId, {
    title: "Member Added",
    message: `${actorName} added ${newMemberName} to the workspace.`,
    type: "INFO",
    actorId: adminId,
    link,
    excludeUserIds: [user.id, adminId],
  });
}

export async function removeWorkspaceMember(
  workspaceId: string,
  adminId: string,
  targetUserId: string,
): Promise<void> {
  await requireAdmin(workspaceId, adminId);
  const ws = await findWorkspaceById(workspaceId);
  if (!ws) throw new NotFoundException("Workspace not found");
  if (ws.ownerId === targetUserId) {
    throw new BadRequestException("Cannot remove the owner of the workspace");
  }
  if (!(await findMember(workspaceId, targetUserId))) {
    throw new NotFoundException("Member not found");
  }
  await deleteMember(workspaceId, targetUserId);
  // Mirrors NotificationEventListener.handleMemberRemoved.
  await notifyUser({
    recipientId: targetUserId,
    title: "Removed from Workspace",
    message: `You have been removed from workspace '${ws.name}'.`,
    type: "WARNING",
    workspaceId: null,
    actorId: adminId,
    link: "/home",
  });
}

export async function changeMemberRole(
  workspaceId: string,
  adminId: string,
  targetUserId: string,
  role: MemberRole,
): Promise<void> {
  await requireAdmin(workspaceId, adminId);
  const ws = await findWorkspaceById(workspaceId);
  if (!ws) throw new NotFoundException("Workspace not found");
  if (ws.ownerId === targetUserId) {
    throw new BadRequestException("Cannot change the role of the workspace owner");
  }
  const updated = await updateMemberRole(workspaceId, targetUserId, role);
  if (!updated) throw new NotFoundException("Member not found");
}

export async function workspaceIdForDocument(documentId: string): Promise<string> {
  const doc = await findDocumentById(documentId);
  if (!doc) throw new NotFoundException("Document not found");
  return doc.workspaceId;
}
