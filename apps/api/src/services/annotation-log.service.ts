import { listLogs } from "../store/prisma.js";
import { requireMember } from "./workspace.service.js";

export interface LogPage {
  content: Array<{
    id: string;
    workspaceId: string;
    userId: string;
    actionType: string;
    entityId: string | null;
    payloadJson: string | null;
    timestamp: string;
  }>;
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export async function getLogs(
  workspaceId: string,
  userId: string,
  opts: { page: number; size: number; actionType?: string; from?: string; to?: string },
): Promise<LogPage> {
  await requireMember(workspaceId, userId);
  const size = Math.min(Math.max(1, opts.size), 200);
  const page = Math.max(0, opts.page);
  let all = await listLogs(workspaceId);
  if (opts.actionType) all = all.filter((l) => l.actionType === opts.actionType);
  if (opts.from) all = all.filter((l) => l.timestamp >= (opts.from as string));
  if (opts.to) all = all.filter((l) => l.timestamp <= (opts.to as string));
  const totalElements = all.length;
  const totalPages = Math.max(1, Math.ceil(totalElements / size));
  const content = all.slice(page * size, page * size + size);
  return { content, page, size, totalElements, totalPages };
}
