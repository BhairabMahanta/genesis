/**
 * Persistence entity types. Column-for-column equivalents of the Prisma
 * models (which map the shared Postgres tables). The Prisma repositories
 * speak these shapes.
 */

export type AuthProvider = "LOCAL" | "GOOGLE";
export type AnnotationType = "COREF" | "NER" | "POS" | "WSD";
export type WorkspaceStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";
export type MemberRole = "ADMIN" | "ANNOTATOR" | "CURATOR";
export type DocumentStatus = "UPLOADED" | "IMPORTED" | "ANNOTATING" | "COMPLETE";
export type ProcessingStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface UserEntity {
  id: string;
  username: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  organizationName: string | null;
  authProvider: AuthProvider;
  emailVerified: boolean;
  enabled: boolean;
  accountLocked: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RefreshTokenEntity {
  id: string;
  token: string;
  userId: string;
  expiryDate: string;
  revoked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceEntity {
  id: string;
  name: string;
  description: string | null;
  annotationType: AnnotationType;
  status: WorkspaceStatus;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMemberEntity {
  id: string;
  workspaceId: string;
  userId: string;
  role: MemberRole;
  createdAt: string;
  updatedAt: string;
}

export interface StoredFileEntity {
  id: string;
  publicId: string;
  url: string;
  originalFilename: string;
  contentType: string | null;
  fileSize: number | null;
  folder: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentEntity {
  id: string;
  name: string;
  orderIndex: number;
  fileSize: number | null;
  status: DocumentStatus;
  processingStatus: ProcessingStatus | null;
  processingError: string | null;
  progress: number | null;
  tokenStartIndex: number | null;
  tokenEndIndex: number | null;
  workspaceId: string;
  storedFileId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SentenceEntity {
  id: string;
  documentId: string;
  sentenceIndex: number;
  text: string;
  startOffset: number;
  endOffset: number;
  tokenCount: number | null;
}

export interface TokenEntity {
  id: string;
  documentId: string;
  sentenceIndex: number;
  tokenIndex: number;
  globalIndex: number;
  form: string;
  pos: string | null;
  lemma: string | null;
  nerTag: string | null;
  startOffset: number;
  endOffset: number;
}

export type TagScope = "GLOBAL" | "WORKSPACE";

export interface NerTagEntity {
  id: string;
  tag: string;
  description: string | null;
  scope: TagScope;
  workspaceId: string | null;
  builtin: boolean;
  createdAt: string;
}

export interface NerAnnotationEntity {
  id: string;
  documentId: string;
  workspaceId: string;
  startTokenIndex: number;
  endTokenIndex: number;
  label: string;
  tagId: string | null;
  annotatorId: string;
  createdAt: string;
}

export interface MentionEntity {
  id: string;
  workspaceId: string;
  documentId: string;
  clusterId: string | null;
  sentenceIndex: number;
  startTokenIndex: number;
  endTokenIndex: number;
  globalStartIndex: number;
  globalEndIndex: number;
  text: string;
  mentionType: string | null;
  createdAt: string;
}

export interface ClusterEntity {
  id: string;
  workspaceId: string;
  clusterNumber: number;
  label: string | null;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface PosTagEntity {
  id: string;
  tag: string;
  description: string | null;
  scope: TagScope;
  workspaceId: string | null;
  builtin: boolean;
  createdAt: string;
}

export interface PosAnnotationEntity {
  id: string;
  tokenId: string;
  documentId: string;
  annotatorId: string;
  posTag: string;
  createdAt: string;
  updatedAt: string;
}

export interface WsdSenseEntity {
  id: string;
  workspaceId: string;
  word: string;
  senseLabel: string;
  description: string | null;
  createdAt: string;
}

export interface WsdAnnotationEntity {
  id: string;
  workspaceId: string;
  tokenId: string;
  documentId: string | null;
  senseId: string;
  annotatorId: string;
  createdAt: string;
}

export type NotificationType = "INFO" | "SUCCESS" | "WARNING" | "ERROR";

export interface NotificationEntity {
  id: string;
  recipientId: string;
  actorId: string | null;
  workspaceId: string | null;
  title: string;
  message: string;
  type: NotificationType;
  read: boolean;
  link: string | null;
  createdAt: string;
}

export interface EditorSessionEntity {
  id: string;
  workspaceId: string;
  userId: string;
  lastDocumentIndex: number;
  scrollPosition: number;
  updatedAt: string;
}

export interface AnnotationLogEntity {
  id: string;
  workspaceId: string;
  userId: string;
  actionType: string;
  entityId: string | null;
  payloadJson: string | null;
  timestamp: string;
}

export interface DismissedRecommendationEntity {
  id: string;
  workspaceId: string;
  userId: string;
  recommendationHash: string;
  accepted: boolean;
  createdAt: string;
}
