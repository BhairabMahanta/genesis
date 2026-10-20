import { z } from "zod";

/**
 * Workspace request validation + response DTOs.
 * Bounds mirror the legacy `CreateWorkspaceRequest` / `UpdateWorkspaceRequest` /
 * `AddMemberRequest` annotations and the `workspaces` table columns.
 */

export const annotationTypeSchema = z.enum(["COREF", "NER", "POS", "WSD"]);

export const workspaceStatusSchema = z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]);

export const memberRoleSchema = z.enum(["ADMIN", "ANNOTATOR", "CURATOR"]);

export const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).nullish(),
  annotationType: annotationTypeSchema,
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).nullish(),
});

export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;

export const addMemberSchema = z.object({
  email: z.string().email(),
  role: memberRoleSchema,
});

export type AddMemberInput = z.infer<typeof addMemberSchema>;

export interface WorkspaceResponse {
  id: string;
  name: string;
  description: string | null;
  annotationType: "COREF" | "NER" | "POS" | "WSD";
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  ownerId: string;
  ownerUsername: string;
  documentCount: number;
  annotatedDocumentCount: number;
  progressPercentage: number;
  createdAt: string;
  updatedAt: string;
}

export interface MemberResponse {
  userId: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  role: "ADMIN" | "ANNOTATOR" | "CURATOR";
}
