import { NotFoundException } from "../common/errors.js";
import {
  deleteNotification,
  findUserById,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead,
  saveNotification,
} from "../store/prisma.js";
import type { NotificationDto } from "../schemas/notification.schemas.js";
import type { NotificationType } from "../store/types.js";

/** Mirrors `RecipientDirectoryAdapter.displayName`: "First Last", else Unknown User. */
export async function displayName(userId: string): Promise<string> {
  const user = await findUserById(userId);
  return user ? `${user.firstName} ${user.lastName}` : "Unknown User";
}

export async function notifyUser(input: {
  recipientId: string;
  title: string;
  message: string;
  type: NotificationType;
  workspaceId?: string | null;
  actorId?: string | null;
  link?: string | null;
}): Promise<void> {
  await saveNotification({
    recipientId: input.recipientId,
    actorId: input.actorId ?? null,
    workspaceId: input.workspaceId ?? null,
    title: input.title,
    message: input.message,
    type: input.type,
    read: false,
    link: input.link ?? null,
  });
}

export async function listForUser(userId: string): Promise<NotificationDto[]> {
  const rows = await listNotificationsForUser(userId);
  return rows.map((n) => ({
    id: n.id,
    recipientId: n.recipientId,
    actorId: n.actorId,
    workspaceId: n.workspaceId,
    title: n.title,
    message: n.message,
    type: n.type,
    read: n.read,
    link: n.link,
    createdAt: n.createdAt,
  }));
}

export async function markRead(userId: string, id: string): Promise<void> {
  const updated = await markNotificationRead(id, userId);
  if (!updated) {
    throw new NotFoundException("Notification not found");
  }
}

export async function markAllRead(userId: string): Promise<void> {
  await markAllNotificationsRead(userId);
}

export async function remove(userId: string, id: string): Promise<void> {
  const deleted = await deleteNotification(id, userId);
  if (!deleted) {
    throw new NotFoundException("Notification not found");
  }
}
