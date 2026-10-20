export interface NotificationDto {
  id: string;
  recipientId?: string;
  actorId?: string | null;
  workspaceId?: string | null;
  title: string;
  message: string;
  type: "INFO" | "SUCCESS" | "WARNING" | "ERROR";
  read: boolean;
  link?: string | null;
  createdAt: string;
}
