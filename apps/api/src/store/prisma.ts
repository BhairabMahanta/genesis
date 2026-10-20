import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type {
  annotation_log,
  coref_clusters,
  coref_mentions,
  dismissed_recommendations,
  Document,
  editor_sessions,
  ner_annotations,
  ner_tag_definitions,
  notifications,
  pos_annotations,
  pos_tag_definitions,
  RefreshToken,
  Sentence,
  StoredFile,
  Token,
  User,
  Workspace,
  WorkspaceMember,
  wsd_annotation,
  wsd_sense,
} from "@prisma/client";
import { prisma } from "../db.js";
import { pushToUser } from "../services/stomp-broker.js";
import type {
  AnnotationLogEntity,
  ClusterEntity,
  DismissedRecommendationEntity,
  DocumentEntity,
  EditorSessionEntity,
  MentionEntity,
  NerAnnotationEntity,
  NerTagEntity,
  NotificationEntity,
  NotificationType,
  PosAnnotationEntity,
  PosTagEntity,
  RefreshTokenEntity,
  SentenceEntity,
  StoredFileEntity,
  TagScope,
  TokenEntity,
  UserEntity,
  WorkspaceEntity,
  WorkspaceMemberEntity,
  WsdAnnotationEntity,
  WsdSenseEntity,
} from "./types.js";

/**
 * PostgreSQL-backed persistence. This is the only store used by the API in
 * production and development; there is deliberately no in-memory fallback.
 *
 * Prisma is a typed query client over the Flyway-owned schema. The mapper
 * functions keep the public entity shapes (`store/types.ts`) stable so the
 * HTTP layer does not depend on database column naming.
 */

const AUDIT = "system";
const CLUSTER_COLORS = [
  "#2563eb",
  "#7c3aed",
  "#0ea5e9",
  "#16a34a",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#14b8a6",
];

export const BUILTIN_NER_TAGS: Array<{ tag: string; description: string }> = [
  { tag: "PERSON", description: "People, including fictional" },
  { tag: "NORP", description: "Nationalities, religious or political groups" },
  { tag: "FAC", description: "Buildings, airports, highways, bridges" },
  { tag: "ORG", description: "Companies, agencies, institutions" },
  { tag: "GPE", description: "Countries, cities, states" },
  { tag: "LOC", description: "Non-GPE locations" },
  { tag: "PRODUCT", description: "Vehicles, weapons, foods" },
  { tag: "EVENT", description: "Named hurricanes, battles, wars, sports" },
  { tag: "WORK_OF_ART", description: "Titles of books, songs, etc." },
  { tag: "LAW", description: "Named documents made into laws" },
  { tag: "LANGUAGE", description: "Any named language" },
  { tag: "DATE", description: "Absolute or relative dates or periods" },
  { tag: "TIME", description: "Times smaller than a day" },
  { tag: "PERCENT", description: "Percentage, including %" },
  { tag: "MONEY", description: "Monetary values, including unit" },
  { tag: "QUANTITY", description: "Measurements" },
  { tag: "ORDINAL", description: '"first", "second"' },
  { tag: "CARDINAL", description: "Numerals" },
];

export const BUILTIN_POS_TAGS: Array<{ tag: string; description: string }> = [
  { tag: "NOUN", description: "Common noun" },
  { tag: "PROPN", description: "Proper noun" },
  { tag: "VERB", description: "Verb" },
  { tag: "ADJ", description: "Adjective" },
  { tag: "ADV", description: "Adverb" },
  { tag: "PRON", description: "Pronoun" },
  { tag: "DET", description: "Determiner" },
  { tag: "ADP", description: "Adposition" },
  { tag: "CONJ", description: "Coordinating conjunction" },
  { tag: "SCONJ", description: "Subordinating conjunction" },
  { tag: "AUX", description: "Auxiliary verb" },
  { tag: "NUM", description: "Numeral" },
  { tag: "PART", description: "Particle" },
  { tag: "INTJ", description: "Interjection" },
  { tag: "SYM", description: "Symbol" },
  { tag: "PUNCT", description: "Punctuation" },
  { tag: "X", description: "Other/unknown" },
];

function now(): Date {
  return new Date();
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function requiredIso(value: Date): string {
  return value.toISOString();
}

// --- users ---------------------------------------------------------------

function mapUser(row: User): UserEntity {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    password: row.password,
    firstName: row.firstName,
    lastName: row.lastName,
    organizationName: row.organizationName,
    authProvider: row.authProvider as UserEntity["authProvider"],
    emailVerified: row.emailVerified,
    enabled: row.enabled,
    accountLocked: row.accountLocked,
    lastLoginAt: iso(row.lastLoginAt),
    createdAt: requiredIso(row.createdAt),
    updatedAt: requiredIso(row.updatedAt),
  };
}

export async function saveUser(
  input: Omit<UserEntity, "id" | "createdAt" | "updatedAt">,
): Promise<UserEntity> {
  const timestamp = now();
  const row = await prisma.user.create({
    data: {
      id: randomUUID(),
      username: input.username,
      email: input.email,
      password: input.password,
      firstName: input.firstName,
      lastName: input.lastName,
      organizationName: input.organizationName,
      authProvider: input.authProvider,
      emailVerified: input.emailVerified,
      enabled: input.enabled,
      accountLocked: input.accountLocked,
      lastLoginAt: input.lastLoginAt ? new Date(input.lastLoginAt) : null,
      createdAt: timestamp,
      createdBy: input.username || AUDIT,
      updatedAt: timestamp,
      updatedBy: input.username || AUDIT,
      version: 0n,
    },
  });
  return mapUser(row);
}

export async function findUserById(id: string): Promise<UserEntity | undefined> {
  const row = await prisma.user.findUnique({ where: { id } });
  return row ? mapUser(row) : undefined;
}

export async function findUserByUsername(username: string): Promise<UserEntity | undefined> {
  const row = await prisma.user.findFirst({
    where: { username: { equals: username, mode: "insensitive" } },
  });
  return row ? mapUser(row) : undefined;
}

export async function findUserByEmail(email: string): Promise<UserEntity | undefined> {
  const row = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });
  return row ? mapUser(row) : undefined;
}

export async function findUserByUsernameOrEmail(
  usernameOrEmail: string,
): Promise<UserEntity | undefined> {
  const row = await prisma.user.findFirst({
    where: {
      OR: [
        { username: { equals: usernameOrEmail, mode: "insensitive" } },
        { email: { equals: usernameOrEmail, mode: "insensitive" } },
      ],
    },
  });
  return row ? mapUser(row) : undefined;
}

export async function touchUserLogin(userId: string): Promise<void> {
  const timestamp = now();
  await prisma.user.updateMany({
    where: { id: userId },
    data: { lastLoginAt: timestamp, updatedAt: timestamp, updatedBy: userId },
  });
}

// --- refresh tokens --------------------------------------------------------

function mapRefreshToken(row: RefreshToken): RefreshTokenEntity {
  return {
    id: row.id,
    token: row.token,
    userId: row.userId,
    expiryDate: requiredIso(row.expiryDate),
    revoked: row.revoked,
    createdAt: requiredIso(row.createdAt),
    updatedAt: requiredIso(row.updatedAt),
  };
}

export async function saveRefreshToken(input: {
  token: string;
  userId: string;
  expiryDate: string;
}): Promise<RefreshTokenEntity> {
  const timestamp = now();
  const row = await prisma.refreshToken.create({
    data: {
      id: randomUUID(),
      token: input.token,
      userId: input.userId,
      expiryDate: new Date(input.expiryDate),
      revoked: false,
      createdAt: timestamp,
      created_by: input.userId,
      updatedAt: timestamp,
      updated_by: input.userId,
      version: 0n,
    },
  });
  return mapRefreshToken(row);
}

export async function findRefreshToken(token: string): Promise<RefreshTokenEntity | undefined> {
  const row = await prisma.refreshToken.findUnique({ where: { token } });
  return row ? mapRefreshToken(row) : undefined;
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { token },
    data: { revoked: true, updatedAt: now(), updated_by: AUDIT },
  });
}

export async function deleteRefreshToken(token: string): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { token } });
}

// --- workspaces --------------------------------------------------------------

function mapWorkspace(row: Workspace): WorkspaceEntity {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    annotationType: row.annotationType as WorkspaceEntity["annotationType"],
    status: row.status as WorkspaceEntity["status"],
    ownerId: row.ownerId,
    createdAt: requiredIso(row.createdAt),
    updatedAt: requiredIso(row.updatedAt),
  };
}

export async function saveWorkspace(
  input: Omit<WorkspaceEntity, "id" | "createdAt" | "updatedAt">,
): Promise<WorkspaceEntity> {
  const timestamp = now();
  const row = await prisma.workspace.create({
    data: {
      id: randomUUID(),
      name: input.name,
      description: input.description,
      annotationType: input.annotationType,
      status: input.status,
      ownerId: input.ownerId,
      createdAt: timestamp,
      createdBy: input.ownerId,
      updatedAt: timestamp,
      updatedBy: input.ownerId,
      version: 0n,
    },
  });
  return mapWorkspace(row);
}

export async function findWorkspaceById(id: string): Promise<WorkspaceEntity | undefined> {
  const row = await prisma.workspace.findUnique({ where: { id } });
  return row ? mapWorkspace(row) : undefined;
}

export async function updateWorkspaceEntity(
  id: string,
  patch: Partial<WorkspaceEntity>,
): Promise<WorkspaceEntity | undefined> {
  const data: Prisma.WorkspaceUncheckedUpdateInput = { updatedAt: now(), updatedBy: AUDIT };
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.annotationType !== undefined) data.annotationType = patch.annotationType;
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.ownerId !== undefined) data.ownerId = patch.ownerId;
  const result = await prisma.workspace.updateMany({ where: { id }, data });
  if (result.count === 0) return undefined;
  return findWorkspaceById(id);
}

export async function deleteWorkspaceEntity(id: string): Promise<void> {
  // `documents.workspace_id` and `workspace_members.workspace_id` are
  // NO ACTION in the Flyway schema, so children must be removed explicitly.
  // The remaining child tables cascade from `workspaces`.
  await prisma.$transaction(async (tx) => {
    await tx.document.deleteMany({ where: { workspaceId: id } });
    await tx.workspaceMember.deleteMany({ where: { workspaceId: id } });
    await tx.workspace.deleteMany({ where: { id } });
  });
}

export async function existsWorkspaceByNameAndOwnerId(
  name: string,
  ownerId: string,
): Promise<boolean> {
  const row = await prisma.workspace.findFirst({
    where: {
      ownerId,
      name: { equals: name, mode: "insensitive" },
    },
    select: { id: true },
  });
  return row !== null;
}

export async function listWorkspacesForUser(userId: string): Promise<WorkspaceEntity[]> {
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId },
    include: { workspace: true },
  });
  return memberships
    .map((membership) => mapWorkspace(membership.workspace))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// --- workspace members ---------------------------------------------------------

function mapWorkspaceMember(row: WorkspaceMember): WorkspaceMemberEntity {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    role: row.role as WorkspaceMemberEntity["role"],
    createdAt: requiredIso(row.createdAt),
    updatedAt: requiredIso(row.updatedAt),
  };
}

export async function saveMember(input: {
  workspaceId: string;
  userId: string;
  role: WorkspaceMemberEntity["role"];
}): Promise<WorkspaceMemberEntity> {
  const timestamp = now();
  const row = await prisma.workspaceMember.create({
    data: {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      userId: input.userId,
      role: input.role,
      createdAt: timestamp,
      created_by: AUDIT,
      updatedAt: timestamp,
      updated_by: AUDIT,
      version: 0n,
    },
  });
  return mapWorkspaceMember(row);
}

export async function findMember(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceMemberEntity | undefined> {
  const row = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
  return row ? mapWorkspaceMember(row) : undefined;
}

export async function listMembers(workspaceId: string): Promise<WorkspaceMemberEntity[]> {
  const rows = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(mapWorkspaceMember);
}

export async function updateMemberRole(
  workspaceId: string,
  userId: string,
  role: WorkspaceMemberEntity["role"],
): Promise<WorkspaceMemberEntity | undefined> {
  const result = await prisma.workspaceMember.updateMany({
    where: { workspaceId, userId },
    data: { role, updatedAt: now(), updated_by: AUDIT },
  });
  if (result.count === 0) return undefined;
  return findMember(workspaceId, userId);
}

export async function deleteMember(workspaceId: string, userId: string): Promise<void> {
  await prisma.workspaceMember.deleteMany({ where: { workspaceId, userId } });
}

// --- stored files + documents ----------------------------------------------------

function mapStoredFile(row: StoredFile): StoredFileEntity {
  return {
    id: row.id,
    publicId: row.publicId,
    url: row.url,
    originalFilename: row.originalFilename,
    contentType: row.contentType,
    fileSize: row.fileSize === null ? null : Number(row.fileSize),
    folder: row.folder,
    createdAt: requiredIso(row.createdAt),
    updatedAt: requiredIso(row.updatedAt),
  };
}

export async function saveStoredFile(
  input: Omit<StoredFileEntity, "id" | "createdAt" | "updatedAt">,
): Promise<StoredFileEntity> {
  const timestamp = now();
  const row = await prisma.storedFile.create({
    data: {
      id: randomUUID(),
      publicId: input.publicId,
      url: input.url,
      originalFilename: input.originalFilename,
      contentType: input.contentType,
      fileSize: input.fileSize === null ? null : BigInt(input.fileSize),
      folder: input.folder,
      createdAt: timestamp,
      created_by: AUDIT,
      updatedAt: timestamp,
      updated_by: AUDIT,
      version: 0n,
    },
  });
  return mapStoredFile(row);
}

export async function findStoredFileById(id: string): Promise<StoredFileEntity | undefined> {
  const row = await prisma.storedFile.findUnique({ where: { id } });
  return row ? mapStoredFile(row) : undefined;
}

export async function deleteStoredFile(id: string): Promise<void> {
  await prisma.storedFile.deleteMany({ where: { id } });
}

function mapDocument(row: Document): DocumentEntity {
  return {
    id: row.id,
    name: row.name,
    orderIndex: row.orderIndex,
    fileSize: row.fileSize === null ? null : Number(row.fileSize),
    status: row.status as DocumentEntity["status"],
    processingStatus: row.processingStatus as DocumentEntity["processingStatus"],
    processingError: row.processingError,
    progress: row.progress,
    tokenStartIndex: row.tokenStartIndex,
    tokenEndIndex: row.tokenEndIndex,
    workspaceId: row.workspaceId,
    storedFileId: row.storedFileId,
    createdAt: requiredIso(row.createdAt),
    updatedAt: requiredIso(row.updatedAt),
  };
}

export async function saveDocument(
  input: Omit<DocumentEntity, "id" | "createdAt" | "updatedAt">,
): Promise<DocumentEntity> {
  const timestamp = now();
  const row = await prisma.document.create({
    data: {
      id: randomUUID(),
      name: input.name,
      orderIndex: input.orderIndex,
      fileSize: input.fileSize === null ? null : BigInt(input.fileSize),
      status: input.status,
      processingStatus: input.processingStatus,
      processingError: input.processingError,
      progress: input.progress,
      tokenStartIndex: input.tokenStartIndex,
      tokenEndIndex: input.tokenEndIndex,
      workspaceId: input.workspaceId,
      storedFileId: input.storedFileId,
      createdAt: timestamp,
      createdBy: AUDIT,
      updatedAt: timestamp,
      updatedBy: AUDIT,
      version: 0n,
    },
  });
  return mapDocument(row);
}

export async function findDocumentById(id: string): Promise<DocumentEntity | undefined> {
  const row = await prisma.document.findUnique({ where: { id } });
  return row ? mapDocument(row) : undefined;
}

export async function updateDocumentEntity(
  id: string,
  patch: Partial<DocumentEntity>,
): Promise<DocumentEntity | undefined> {
  const data: Prisma.DocumentUncheckedUpdateInput = { updatedAt: now(), updatedBy: AUDIT };
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.orderIndex !== undefined) data.orderIndex = patch.orderIndex;
  if (patch.fileSize !== undefined) {
    data.fileSize = patch.fileSize === null ? null : BigInt(patch.fileSize);
  }
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.processingStatus !== undefined) data.processingStatus = patch.processingStatus;
  if (patch.processingError !== undefined) data.processingError = patch.processingError;
  if (patch.progress !== undefined) data.progress = patch.progress;
  if (patch.tokenStartIndex !== undefined) data.tokenStartIndex = patch.tokenStartIndex;
  if (patch.tokenEndIndex !== undefined) data.tokenEndIndex = patch.tokenEndIndex;
  if (patch.workspaceId !== undefined) data.workspaceId = patch.workspaceId;
  if (patch.storedFileId !== undefined) data.storedFileId = patch.storedFileId;
  const result = await prisma.document.updateMany({ where: { id }, data });
  if (result.count === 0) return undefined;
  return findDocumentById(id);
}

export async function deleteDocumentEntity(id: string): Promise<void> {
  // sentences, tokens, coref mentions, NER/POS/WSD annotations cascade in
  // the database. The stored file is removed separately by the service so
  // the external object is not leaked if the DB delete fails.
  await prisma.document.deleteMany({ where: { id } });
}

export async function listDocumentsByWorkspace(workspaceId: string): Promise<DocumentEntity[]> {
  const rows = await prisma.document.findMany({
    where: { workspaceId },
    orderBy: { orderIndex: "asc" },
  });
  return rows.map(mapDocument);
}

export async function maxOrderIndex(workspaceId: string): Promise<number | null> {
  const result = await prisma.document.aggregate({
    where: { workspaceId },
    _max: { orderIndex: true },
  });
  return result._max.orderIndex ?? null;
}

// --- sentences + tokens ------------------------------------------------------------

function mapSentence(row: Sentence): SentenceEntity {
  return {
    id: row.id,
    documentId: row.documentId,
    sentenceIndex: row.sentenceIndex,
    text: row.text ?? "",
    startOffset: row.startOffset,
    endOffset: row.endOffset,
    tokenCount: row.tokenCount,
  };
}

function mapToken(row: Token): TokenEntity {
  return {
    id: row.id,
    documentId: row.documentId,
    sentenceIndex: row.sentenceIndex,
    tokenIndex: row.tokenIndex,
    globalIndex: row.globalIndex,
    form: row.form,
    pos: row.pos,
    lemma: row.lemma,
    nerTag: row.nerTag,
    startOffset: row.startOffset,
    endOffset: row.endOffset,
  };
}

export async function replaceDocumentContent(
  documentId: string,
  newSentences: Omit<SentenceEntity, "id" | "documentId">[],
  newTokens: Omit<TokenEntity, "id" | "documentId">[],
): Promise<{ sentenceCount: number; tokenCount: number }> {
  const timestamp = now();
  await prisma.$transaction(async (tx) => {
    await tx.sentence.deleteMany({ where: { documentId } });
    await tx.token.deleteMany({ where: { documentId } });
    if (newSentences.length > 0) {
      await tx.sentence.createMany({
        data: newSentences.map((sentence) => ({
          id: randomUUID(),
          documentId,
          sentenceIndex: sentence.sentenceIndex,
          text: sentence.text,
          startOffset: sentence.startOffset,
          endOffset: sentence.endOffset,
          tokenCount: sentence.tokenCount,
          createdAt: timestamp,
          created_by: AUDIT,
          updatedAt: timestamp,
          updated_by: AUDIT,
          version: 0n,
        })),
      });
    }
    if (newTokens.length > 0) {
      await tx.token.createMany({
        data: newTokens.map((token) => ({
          id: randomUUID(),
          documentId,
          sentenceIndex: token.sentenceIndex,
          tokenIndex: token.tokenIndex,
          globalIndex: token.globalIndex,
          form: token.form,
          pos: token.pos,
          lemma: token.lemma,
          nerTag: token.nerTag,
          startOffset: token.startOffset,
          endOffset: token.endOffset,
          createdAt: timestamp,
          created_by: AUDIT,
          updatedAt: timestamp,
          updated_by: AUDIT,
          version: 0n,
        })),
      });
    }
  });
  return { sentenceCount: newSentences.length, tokenCount: newTokens.length };
}

export async function listSentences(documentId: string): Promise<SentenceEntity[]> {
  const rows = await prisma.sentence.findMany({
    where: { documentId },
    orderBy: { sentenceIndex: "asc" },
  });
  return rows.map(mapSentence);
}

export async function listTokens(documentId: string): Promise<TokenEntity[]> {
  const rows = await prisma.token.findMany({
    where: { documentId },
    orderBy: { tokenIndex: "asc" },
  });
  return rows.map(mapToken);
}

export async function findTokenById(tokenId: string): Promise<TokenEntity | undefined> {
  const row = await prisma.token.findUnique({ where: { id: tokenId } });
  return row ? mapToken(row) : undefined;
}

export async function countTokens(documentId: string): Promise<number> {
  return prisma.token.count({ where: { documentId } });
}

// --- NER ---------------------------------------------------------------

function mapNerTag(row: ner_tag_definitions): NerTagEntity {
  return {
    id: row.id,
    tag: row.tag,
    description: row.description,
    scope: row.scope as NerTagEntity["scope"],
    workspaceId: row.workspace_id,
    builtin: false,
    createdAt: requiredIso(row.created_at),
  };
}

export async function saveNerTag(
  input: Omit<NerTagEntity, "id" | "createdAt">,
): Promise<NerTagEntity> {
  const timestamp = now();
  const row = await prisma.ner_tag_definitions.create({
    data: {
      id: randomUUID(),
      tag: input.tag,
      description: input.description,
      scope: input.scope,
      workspace_id: input.workspaceId,
      created_by_user_id: AUDIT,
      created_at: timestamp,
      created_by: AUDIT,
      updated_at: timestamp,
      updated_by: AUDIT,
      version: 0n,
    },
  });
  return mapNerTag(row);
}

export async function listNerTags(workspaceId?: string): Promise<NerTagEntity[]> {
  const rows = await prisma.ner_tag_definitions.findMany({
    where: {
      OR: [
        { scope: "GLOBAL" },
        ...(workspaceId ? [{ scope: "WORKSPACE", workspace_id: workspaceId }] : []),
      ],
    },
    orderBy: { created_at: "asc" },
  });
  return rows.map(mapNerTag);
}

export async function findNerTagDefinition(
  tag: string,
  scope: TagScope,
  workspaceId: string | null,
): Promise<NerTagEntity | undefined> {
  const row = await prisma.ner_tag_definitions.findFirst({
    where: { tag, scope, workspace_id: workspaceId },
  });
  return row ? mapNerTag(row) : undefined;
}

export async function findNerTagById(id: string): Promise<NerTagEntity | undefined> {
  const row = await prisma.ner_tag_definitions.findUnique({ where: { id } });
  return row ? mapNerTag(row) : undefined;
}

export async function deleteNerTag(id: string): Promise<void> {
  await prisma.ner_tag_definitions.deleteMany({ where: { id } });
}

type NerAnnotationRow = ner_annotations & { documents: { workspaceId: string } };

function mapNerAnnotation(row: NerAnnotationRow): NerAnnotationEntity {
  return {
    id: row.id,
    documentId: row.document_id,
    workspaceId: row.documents.workspaceId,
    startTokenIndex: row.start_token_index,
    endTokenIndex: row.end_token_index,
    label: row.label,
    tagId: null,
    annotatorId: row.annotator_id,
    createdAt: requiredIso(row.timestamp),
  };
}

export async function saveNerAnnotation(
  input: Omit<NerAnnotationEntity, "id" | "createdAt">,
): Promise<NerAnnotationEntity> {
  const timestamp = now();
  const row = await prisma.ner_annotations.create({
    data: {
      id: randomUUID(),
      document_id: input.documentId,
      start_token_index: input.startTokenIndex,
      end_token_index: input.endTokenIndex,
      label: input.label,
      annotator_id: input.annotatorId,
      timestamp,
      created_at: timestamp,
      created_by: AUDIT,
      updated_at: timestamp,
      updated_by: AUDIT,
      version: 0n,
    },
    include: { documents: { select: { workspaceId: true } } },
  });
  return mapNerAnnotation(row);
}

export async function findNerAnnotation(id: string): Promise<NerAnnotationEntity | undefined> {
  const row = await prisma.ner_annotations.findUnique({
    where: { id },
    include: { documents: { select: { workspaceId: true } } },
  });
  return row ? mapNerAnnotation(row) : undefined;
}

export async function listNerAnnotations(
  documentId: string,
  annotatorId?: string,
): Promise<NerAnnotationEntity[]> {
  const rows = await prisma.ner_annotations.findMany({
    where: {
      document_id: documentId,
      ...(annotatorId ? { annotator_id: annotatorId } : {}),
    },
    include: { documents: { select: { workspaceId: true } } },
    orderBy: { timestamp: "asc" },
  });
  return rows.map(mapNerAnnotation);
}

export async function updateNerAnnotation(
  id: string,
  patch: Partial<NerAnnotationEntity>,
): Promise<NerAnnotationEntity | undefined> {
  const data: Prisma.ner_annotationsUncheckedUpdateInput = { updated_at: now(), updated_by: AUDIT };
  if (patch.startTokenIndex !== undefined) data.start_token_index = patch.startTokenIndex;
  if (patch.endTokenIndex !== undefined) data.end_token_index = patch.endTokenIndex;
  if (patch.label !== undefined) data.label = patch.label;
  if (patch.annotatorId !== undefined) data.annotator_id = patch.annotatorId;
  if (patch.createdAt !== undefined) data.timestamp = new Date(patch.createdAt);
  const result = await prisma.ner_annotations.updateMany({ where: { id }, data });
  if (result.count === 0) return undefined;
  return findNerAnnotation(id);
}

export async function deleteNerAnnotation(id: string): Promise<void> {
  await prisma.ner_annotations.deleteMany({ where: { id } });
}

// --- coref -------------------------------------------------------------

function mapMention(row: coref_mentions): MentionEntity {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    documentId: row.document_id,
    clusterId: row.cluster_id,
    sentenceIndex: row.sentence_index,
    startTokenIndex: row.start_token_index,
    endTokenIndex: row.end_token_index,
    globalStartIndex: row.global_start_index ?? 0,
    globalEndIndex: row.global_end_index ?? 0,
    text: row.text ?? "",
    mentionType: row.mention_type,
    createdAt: requiredIso(row.created_at),
  };
}

function mapCluster(row: coref_clusters): ClusterEntity {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    clusterNumber: row.cluster_number,
    label: row.label,
    color: row.color ?? "#2563eb",
    createdAt: requiredIso(row.created_at),
    updatedAt: requiredIso(row.updated_at),
  };
}

async function nextClusterNumber(workspaceId: string): Promise<number> {
  const result = await prisma.coref_clusters.aggregate({
    where: { workspace_id: workspaceId },
    _max: { cluster_number: true },
  });
  return (result._max.cluster_number ?? 0) + 1;
}

async function pickClusterColor(workspaceId: string): Promise<string> {
  const count = await prisma.coref_clusters.count({ where: { workspace_id: workspaceId } });
  return CLUSTER_COLORS[count % CLUSTER_COLORS.length] as string;
}

export async function saveMention(
  input: Omit<MentionEntity, "id" | "createdAt">,
): Promise<MentionEntity> {
  const timestamp = now();
  const row = await prisma.coref_mentions.create({
    data: {
      id: randomUUID(),
      workspace_id: input.workspaceId,
      document_id: input.documentId,
      cluster_id: input.clusterId,
      sentence_index: input.sentenceIndex,
      start_token_index: input.startTokenIndex,
      end_token_index: input.endTokenIndex,
      global_start_index: input.globalStartIndex,
      global_end_index: input.globalEndIndex,
      text: input.text,
      mention_type: input.mentionType,
      created_at: timestamp,
      created_by: AUDIT,
      updated_at: timestamp,
      updated_by: AUDIT,
      version: 0n,
    },
  });
  return mapMention(row);
}

export async function findMention(id: string): Promise<MentionEntity | undefined> {
  const row = await prisma.coref_mentions.findUnique({ where: { id } });
  return row ? mapMention(row) : undefined;
}

export async function listMentionsByWorkspace(workspaceId: string): Promise<MentionEntity[]> {
  const rows = await prisma.coref_mentions.findMany({
    where: { workspace_id: workspaceId },
    orderBy: { created_at: "asc" },
  });
  return rows.map(mapMention);
}

export async function listMentionsByDocument(documentId: string): Promise<MentionEntity[]> {
  const rows = await prisma.coref_mentions.findMany({
    where: { document_id: documentId },
    orderBy: [{ sentence_index: "asc" }, { start_token_index: "asc" }],
  });
  return rows.map(mapMention);
}

export async function listUnassignedMentions(workspaceId: string): Promise<MentionEntity[]> {
  const rows = await prisma.coref_mentions.findMany({
    where: { workspace_id: workspaceId, cluster_id: null },
    orderBy: { created_at: "asc" },
  });
  return rows.map(mapMention);
}

export async function updateMention(
  id: string,
  patch: Partial<MentionEntity>,
): Promise<MentionEntity | undefined> {
  const data: Prisma.coref_mentionsUncheckedUpdateInput = { updated_at: now(), updated_by: AUDIT };
  if (patch.clusterId !== undefined) data.cluster_id = patch.clusterId;
  if (patch.sentenceIndex !== undefined) data.sentence_index = patch.sentenceIndex;
  if (patch.startTokenIndex !== undefined) data.start_token_index = patch.startTokenIndex;
  if (patch.endTokenIndex !== undefined) data.end_token_index = patch.endTokenIndex;
  if (patch.globalStartIndex !== undefined) data.global_start_index = patch.globalStartIndex;
  if (patch.globalEndIndex !== undefined) data.global_end_index = patch.globalEndIndex;
  if (patch.text !== undefined) data.text = patch.text;
  if (patch.mentionType !== undefined) data.mention_type = patch.mentionType;
  const result = await prisma.coref_mentions.updateMany({ where: { id }, data });
  if (result.count === 0) return undefined;
  return findMention(id);
}

export async function deleteMention(id: string): Promise<void> {
  await prisma.coref_mentions.deleteMany({ where: { id } });
}

export async function deleteMentionsByDocument(documentId: string): Promise<void> {
  await prisma.coref_mentions.deleteMany({ where: { document_id: documentId } });
}

export async function sumMentionTokensByDocumentId(documentId: string): Promise<number> {
  const rows = await prisma.coref_mentions.findMany({
    where: { document_id: documentId },
    select: { start_token_index: true, end_token_index: true },
  });
  return rows.reduce((total, row) => total + row.end_token_index - row.start_token_index + 1, 0);
}

export async function saveCluster(input: {
  workspaceId: string;
  label?: string | null;
  color?: string;
  clusterNumber?: number;
}): Promise<ClusterEntity> {
  const timestamp = now();
  const clusterNumber = input.clusterNumber ?? (await nextClusterNumber(input.workspaceId));
  const color = input.color ?? (await pickClusterColor(input.workspaceId));
  const row = await prisma.coref_clusters.create({
    data: {
      id: randomUUID(),
      workspace_id: input.workspaceId,
      cluster_number: clusterNumber,
      label: input.label ?? null,
      color,
      mention_count: 0,
      representative_text: null,
      created_at: timestamp,
      created_by: AUDIT,
      updated_at: timestamp,
      updated_by: AUDIT,
      version: 0n,
    },
  });
  return mapCluster(row);
}

export async function findCluster(id: string): Promise<ClusterEntity | undefined> {
  const row = await prisma.coref_clusters.findUnique({ where: { id } });
  return row ? mapCluster(row) : undefined;
}

export async function listClustersByWorkspace(workspaceId: string): Promise<ClusterEntity[]> {
  const rows = await prisma.coref_clusters.findMany({
    where: { workspace_id: workspaceId },
    orderBy: { cluster_number: "asc" },
  });
  return rows.map(mapCluster);
}

export async function listMentionsByCluster(clusterId: string): Promise<MentionEntity[]> {
  const rows = await prisma.coref_mentions.findMany({
    where: { cluster_id: clusterId },
    orderBy: [{ sentence_index: "asc" }, { start_token_index: "asc" }],
  });
  return rows.map(mapMention);
}

export async function updateCluster(
  id: string,
  patch: { label?: string | null; color?: string },
): Promise<ClusterEntity | undefined> {
  const data: Prisma.coref_clustersUncheckedUpdateInput = { updated_at: now(), updated_by: AUDIT };
  if (patch.label !== undefined) data.label = patch.label;
  if (patch.color !== undefined) data.color = patch.color;
  const result = await prisma.coref_clusters.updateMany({ where: { id }, data });
  if (result.count === 0) return undefined;
  return findCluster(id);
}

async function renumberClusters(tx: Prisma.TransactionClient, workspaceId: string): Promise<void> {
  const rows = await tx.coref_clusters.findMany({
    where: { workspace_id: workspaceId },
    orderBy: [{ cluster_number: "asc" }, { created_at: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (rows.length === 0) return;

  // Move every row out of the positive range first so the final sequential
  // updates cannot collide with the `(workspace_id, cluster_number)` unique
  // constraint.
  const timestamp = now();
  for (let index = 0; index < rows.length; index += 1) {
    await tx.coref_clusters.update({
      where: { id: rows[index]!.id },
      data: { cluster_number: -1_000_000 - index, updated_at: timestamp, updated_by: AUDIT },
    });
  }
  for (let index = 0; index < rows.length; index += 1) {
    await tx.coref_clusters.update({
      where: { id: rows[index]!.id },
      data: { cluster_number: index + 1, updated_at: timestamp, updated_by: AUDIT },
    });
  }
}

export async function deleteCluster(id: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const cluster = await tx.coref_clusters.findUnique({
      where: { id },
      select: { workspace_id: true },
    });
    if (!cluster) return;
    await tx.coref_mentions.updateMany({
      where: { cluster_id: id },
      data: { cluster_id: null, updated_at: now(), updated_by: AUDIT },
    });
    await tx.coref_clusters.delete({ where: { id } });
    await renumberClusters(tx, cluster.workspace_id);
  });
}

export async function mergeClusters(
  workspaceId: string,
  sourceIds: string[],
  targetId: string,
): Promise<ClusterEntity | undefined> {
  return prisma.$transaction(async (tx) => {
    const target = await tx.coref_clusters.findFirst({
      where: { id: targetId, workspace_id: workspaceId },
    });
    if (!target) return undefined;

    const sources = sourceIds.filter((id) => id !== targetId);
    if (sources.length > 0) {
      await tx.coref_mentions.updateMany({
        where: { cluster_id: { in: sources }, workspace_id: workspaceId },
        data: { cluster_id: targetId, updated_at: now(), updated_by: AUDIT },
      });
      await tx.coref_clusters.deleteMany({
        where: { id: { in: sources }, workspace_id: workspaceId },
      });
    }

    await renumberClusters(tx, workspaceId);
    const refreshed = await tx.coref_clusters.findUnique({ where: { id: targetId } });
    return refreshed ? mapCluster(refreshed) : undefined;
  });
}

export async function corefStats(workspaceId: string): Promise<{
  mentionCount: number;
  clusterCount: number;
  assignedMentionCount: number;
  unassignedMentionCount: number;
}> {
  const [mentionCount, clusterCount, assignedMentionCount] = await Promise.all([
    prisma.coref_mentions.count({ where: { workspace_id: workspaceId } }),
    prisma.coref_clusters.count({ where: { workspace_id: workspaceId } }),
    prisma.coref_mentions.count({
      where: { workspace_id: workspaceId, cluster_id: { not: null } },
    }),
  ]);
  return {
    mentionCount,
    clusterCount,
    assignedMentionCount,
    unassignedMentionCount: mentionCount - assignedMentionCount,
  };
}

// --- POS ---------------------------------------------------------------

function mapPosTag(row: pos_tag_definitions): PosTagEntity {
  return {
    id: row.id,
    tag: row.tag,
    description: row.description,
    scope: row.scope as PosTagEntity["scope"],
    workspaceId: row.workspace_id,
    builtin: false,
    createdAt: requiredIso(row.created_at),
  };
}

export async function savePosTag(
  input: Omit<PosTagEntity, "id" | "createdAt">,
): Promise<PosTagEntity> {
  const timestamp = now();
  const row = await prisma.pos_tag_definitions.create({
    data: {
      id: randomUUID(),
      tag: input.tag,
      description: input.description,
      scope: input.scope,
      workspace_id: input.workspaceId,
      created_by_user_id: AUDIT,
      created_at: timestamp,
      created_by: AUDIT,
      updated_at: timestamp,
      updated_by: AUDIT,
      version: 0n,
    },
  });
  return mapPosTag(row);
}

export async function listPosTags(workspaceId?: string): Promise<PosTagEntity[]> {
  const rows = await prisma.pos_tag_definitions.findMany({
    where: {
      OR: [
        { scope: "GLOBAL" },
        ...(workspaceId ? [{ scope: "WORKSPACE", workspace_id: workspaceId }] : []),
      ],
    },
    orderBy: { created_at: "asc" },
  });
  return rows.map(mapPosTag);
}

export async function findPosTagDefinition(
  tag: string,
  scope: TagScope,
  workspaceId: string | null,
): Promise<PosTagEntity | undefined> {
  const row = await prisma.pos_tag_definitions.findFirst({
    where: { tag, scope, workspace_id: workspaceId },
  });
  return row ? mapPosTag(row) : undefined;
}

export async function findPosTagById(id: string): Promise<PosTagEntity | undefined> {
  const row = await prisma.pos_tag_definitions.findUnique({ where: { id } });
  return row ? mapPosTag(row) : undefined;
}

export async function deletePosTag(id: string): Promise<void> {
  await prisma.pos_tag_definitions.deleteMany({ where: { id } });
}

function mapPosAnnotation(row: pos_annotations): PosAnnotationEntity {
  return {
    id: row.id,
    tokenId: row.token_id,
    documentId: row.document_id,
    annotatorId: row.annotator_id,
    posTag: row.pos_tag,
    createdAt: requiredIso(row.created_at),
    updatedAt: requiredIso(row.updated_at),
  };
}

export async function upsertPosAnnotation(input: {
  tokenId: string;
  documentId: string;
  annotatorId: string;
  posTag: string;
}): Promise<PosAnnotationEntity> {
  const timestamp = now();
  const row = await prisma.pos_annotations.upsert({
    where: {
      token_id_annotator_id: {
        token_id: input.tokenId,
        annotator_id: input.annotatorId,
      },
    },
    create: {
      id: randomUUID(),
      token_id: input.tokenId,
      document_id: input.documentId,
      annotator_id: input.annotatorId,
      pos_tag: input.posTag,
      timestamp,
      created_at: timestamp,
      created_by: input.annotatorId,
      updated_at: timestamp,
      updated_by: input.annotatorId,
      version: 0n,
    },
    update: {
      document_id: input.documentId,
      pos_tag: input.posTag,
      timestamp,
      updated_at: timestamp,
      updated_by: input.annotatorId,
    },
  });
  return mapPosAnnotation(row);
}

export async function listPosByToken(tokenId: string): Promise<PosAnnotationEntity[]> {
  const rows = await prisma.pos_annotations.findMany({
    where: { token_id: tokenId },
    orderBy: { updated_at: "desc" },
  });
  return rows.map(mapPosAnnotation);
}

export async function listPosByDocument(documentId: string): Promise<PosAnnotationEntity[]> {
  const rows = await prisma.pos_annotations.findMany({
    where: { document_id: documentId },
    orderBy: { updated_at: "desc" },
  });
  return rows.map(mapPosAnnotation);
}

export async function deletePosByTokenAndAnnotator(
  tokenId: string,
  annotatorId: string,
): Promise<void> {
  await prisma.pos_annotations.deleteMany({
    where: { token_id: tokenId, annotator_id: annotatorId },
  });
}

// --- WSD ---------------------------------------------------------------

function mapWsdSense(row: wsd_sense): WsdSenseEntity {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    word: row.word,
    senseLabel: row.sense_label,
    description: row.description,
    createdAt: requiredIso(row.created_at),
  };
}

export async function saveWsdSense(
  input: Omit<WsdSenseEntity, "id" | "createdAt">,
): Promise<WsdSenseEntity> {
  const timestamp = now();
  const row = await prisma.wsd_sense.create({
    data: {
      id: randomUUID(),
      workspace_id: input.workspaceId,
      word: input.word,
      sense_label: input.senseLabel,
      description: input.description,
      created_at: timestamp,
      created_by: AUDIT,
      updated_at: timestamp,
      updated_by: AUDIT,
      version: 0n,
    },
  });
  return mapWsdSense(row);
}

export async function findWsdSense(id: string): Promise<WsdSenseEntity | undefined> {
  const row = await prisma.wsd_sense.findUnique({ where: { id } });
  return row ? mapWsdSense(row) : undefined;
}

export async function listWsdSenses(
  workspaceId: string,
  word?: string,
): Promise<WsdSenseEntity[]> {
  const rows = await prisma.wsd_sense.findMany({
    where: {
      workspace_id: workspaceId,
      ...(word ? { word: { equals: word, mode: "insensitive" } } : {}),
    },
    orderBy: { word: "asc" },
  });
  return rows.map(mapWsdSense);
}

export async function updateWsdSense(
  id: string,
  patch: Partial<WsdSenseEntity>,
): Promise<WsdSenseEntity | undefined> {
  const data: Prisma.wsd_senseUncheckedUpdateInput = { updated_at: now(), updated_by: AUDIT };
  if (patch.word !== undefined) data.word = patch.word;
  if (patch.senseLabel !== undefined) data.sense_label = patch.senseLabel;
  if (patch.description !== undefined) data.description = patch.description;
  const result = await prisma.wsd_sense.updateMany({ where: { id }, data });
  if (result.count === 0) return undefined;
  return findWsdSense(id);
}

export async function deleteWsdSense(id: string): Promise<void> {
  // wsd_annotation.sense_id cascades.
  await prisma.wsd_sense.deleteMany({ where: { id } });
}

function mapWsdAnnotation(row: wsd_annotation): WsdAnnotationEntity {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    tokenId: row.token_id,
    documentId: row.document_id,
    senseId: row.sense_id,
    annotatorId: row.annotator_id,
    createdAt: requiredIso(row.created_at),
  };
}

export async function saveWsdAnnotation(
  input: Omit<WsdAnnotationEntity, "id" | "createdAt">,
): Promise<WsdAnnotationEntity> {
  let documentId = input.documentId;
  if (!documentId) {
    const token = await prisma.token.findUnique({
      where: { id: input.tokenId },
      select: { documentId: true },
    });
    documentId = token?.documentId ?? null;
  }
  if (!documentId) {
    throw new Error(`Cannot save WSD annotation for token ${input.tokenId}: document not found`);
  }

  const timestamp = now();
  const row = await prisma.wsd_annotation.upsert({
    where: {
      token_id_annotator_id: {
        token_id: input.tokenId,
        annotator_id: input.annotatorId,
      },
    },
    create: {
      id: randomUUID(),
      workspace_id: input.workspaceId,
      token_id: input.tokenId,
      document_id: documentId,
      sense_id: input.senseId,
      annotator_id: input.annotatorId,
      timestamp,
      created_at: timestamp,
      created_by: input.annotatorId,
      updated_at: timestamp,
      updated_by: input.annotatorId,
      version: 0n,
    },
    update: {
      workspace_id: input.workspaceId,
      document_id: documentId,
      sense_id: input.senseId,
      timestamp,
      updated_at: timestamp,
      updated_by: input.annotatorId,
    },
  });
  return mapWsdAnnotation(row);
}

export async function findWsdAnnotation(
  id: string,
): Promise<WsdAnnotationEntity | undefined> {
  const row = await prisma.wsd_annotation.findUnique({ where: { id } });
  return row ? mapWsdAnnotation(row) : undefined;
}

export async function listWsdByToken(tokenId: string): Promise<WsdAnnotationEntity[]> {
  const rows = await prisma.wsd_annotation.findMany({
    where: { token_id: tokenId },
    orderBy: { updated_at: "desc" },
  });
  return rows.map(mapWsdAnnotation);
}

export async function listWsdByDocument(
  workspaceId: string,
  documentId: string,
): Promise<WsdAnnotationEntity[]> {
  const rows = await prisma.wsd_annotation.findMany({
    where: { workspace_id: workspaceId, document_id: documentId },
    orderBy: { created_at: "asc" },
  });
  return rows.map(mapWsdAnnotation);
}

export async function listWsdByWorkspace(workspaceId: string): Promise<WsdAnnotationEntity[]> {
  const rows = await prisma.wsd_annotation.findMany({
    where: { workspace_id: workspaceId },
    orderBy: { created_at: "asc" },
  });
  return rows.map(mapWsdAnnotation);
}

export async function deleteWsdAnnotation(id: string): Promise<void> {
  await prisma.wsd_annotation.deleteMany({ where: { id } });
}

// --- notifications -----------------------------------------------------

function mapNotification(row: notifications): NotificationEntity {
  return {
    id: row.id,
    recipientId: row.recipient_id,
    actorId: row.actor_id,
    workspaceId: row.workspace_id,
    title: row.title,
    message: row.message,
    type: (row.type ?? "INFO") as NotificationType,
    read: row.read,
    link: row.link,
    createdAt: requiredIso(row.created_at),
  };
}

export async function saveNotification(
  input: Omit<NotificationEntity, "id" | "createdAt">,
): Promise<NotificationEntity> {
  const row = await prisma.notifications.create({
    data: {
      id: randomUUID(),
      recipient_id: input.recipientId,
      actor_id: input.actorId,
      workspace_id: input.workspaceId,
      title: input.title,
      message: input.message,
      type: input.type,
      read: input.read,
      link: input.link,
      created_at: now(),
    },
  });
  const notification = mapNotification(row);
  try {
    pushToUser(notification.recipientId, "/user/queue/notifications", {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      workspaceId: notification.workspaceId,
      actorId: notification.actorId,
      link: notification.link,
      read: notification.read,
      createdAt: notification.createdAt,
    });
  } catch {
    // Polling fallback covers delivery; never fail the caller.
  }
  return notification;
}

export async function listNotificationsForUser(userId: string): Promise<NotificationEntity[]> {
  const rows = await prisma.notifications.findMany({
    where: { recipient_id: userId },
    orderBy: { created_at: "desc" },
  });
  return rows.map(mapNotification);
}

export async function markNotificationRead(
  id: string,
  userId?: string,
): Promise<boolean> {
  const result = await prisma.notifications.updateMany({
    where: { id, ...(userId ? { recipient_id: userId } : {}) },
    data: { read: true },
  });
  return result.count > 0;
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  await prisma.notifications.updateMany({
    where: { recipient_id: userId, read: false },
    data: { read: true },
  });
}

export async function deleteNotification(id: string, userId?: string): Promise<boolean> {
  const result = await prisma.notifications.deleteMany({
    where: { id, ...(userId ? { recipient_id: userId } : {}) },
  });
  return result.count > 0;
}

export async function notifyWorkspaceMembers(
  workspaceId: string,
  input: {
    title: string;
    message: string;
    type: NotificationType;
    actorId?: string | null;
    link?: string | null;
    excludeUserIds?: string[];
  },
): Promise<void> {
  const excluded = new Set(input.excludeUserIds ?? []);
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    select: { userId: true },
  });
  await Promise.all(
    members
      .filter((member) => !excluded.has(member.userId))
      .map((member) =>
        saveNotification({
          recipientId: member.userId,
          actorId: input.actorId ?? null,
          workspaceId,
          title: input.title,
          message: input.message,
          type: input.type,
          read: false,
          link: input.link ?? null,
        }),
      ),
  );
}

// --- editor sessions ---------------------------------------------------

function mapEditorSession(row: editor_sessions): EditorSessionEntity {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    lastDocumentIndex: row.last_document_index ?? 0,
    scrollPosition: row.scroll_position ?? 0,
    updatedAt: requiredIso(row.last_accessed_at),
  };
}

export async function getEditorSession(
  workspaceId: string,
  userId: string,
): Promise<EditorSessionEntity | undefined> {
  const row = await prisma.editor_sessions.findUnique({
    where: { workspace_id_user_id: { workspace_id: workspaceId, user_id: userId } },
  });
  return row ? mapEditorSession(row) : undefined;
}

export async function saveEditorSession(input: {
  workspaceId: string;
  userId: string;
  lastDocumentIndex: number;
  scrollPosition: number;
}): Promise<EditorSessionEntity> {
  const timestamp = now();
  const row = await prisma.editor_sessions.upsert({
    where: {
      workspace_id_user_id: {
        workspace_id: input.workspaceId,
        user_id: input.userId,
      },
    },
    create: {
      id: randomUUID(),
      workspace_id: input.workspaceId,
      user_id: input.userId,
      last_document_index: input.lastDocumentIndex,
      scroll_position: input.scrollPosition,
      last_accessed_at: timestamp,
      created_at: timestamp,
      created_by: input.userId,
      updated_at: timestamp,
      updated_by: input.userId,
      version: 0n,
    },
    update: {
      last_document_index: input.lastDocumentIndex,
      scroll_position: input.scrollPosition,
      last_accessed_at: timestamp,
      updated_at: timestamp,
      updated_by: input.userId,
    },
  });
  return mapEditorSession(row);
}

export async function deleteEditorSession(
  workspaceId: string,
  userId: string,
): Promise<void> {
  await prisma.editor_sessions.deleteMany({
    where: { workspace_id: workspaceId, user_id: userId },
  });
}

// --- logs + recommendations --------------------------------------------

function mapAnnotationLog(row: annotation_log): AnnotationLogEntity {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    actionType: row.action_type,
    entityId: row.entity_id,
    payloadJson: row.payload_json,
    timestamp: requiredIso(row.timestamp),
  };
}

export async function appendLog(
  input: Omit<AnnotationLogEntity, "id" | "timestamp">,
): Promise<AnnotationLogEntity> {
  const timestamp = now();
  const row = await prisma.annotation_log.create({
    data: {
      id: randomUUID(),
      workspace_id: input.workspaceId,
      user_id: input.userId,
      action_type: input.actionType,
      entity_id: input.entityId,
      payload_json: input.payloadJson,
      timestamp,
      created_at: timestamp,
      created_by: input.userId,
      updated_at: timestamp,
      updated_by: input.userId,
      version: 0n,
    },
  });
  return mapAnnotationLog(row);
}

export async function listLogs(workspaceId: string): Promise<AnnotationLogEntity[]> {
  const rows = await prisma.annotation_log.findMany({
    where: { workspace_id: workspaceId },
    orderBy: { timestamp: "desc" },
  });
  return rows.map(mapAnnotationLog);
}

function mapDismissedRecommendation(
  row: dismissed_recommendations,
): DismissedRecommendationEntity {
  return {
    id: row.id,
    workspaceId: row.workspace_id ?? "",
    userId: row.user_id,
    recommendationHash: row.recommendation_hash,
    accepted: row.accepted,
    createdAt: requiredIso(row.created_at),
  };
}

export async function dismissRecommendation(input: {
  workspaceId: string;
  userId: string;
  recommendationHash: string;
  accepted: boolean;
}): Promise<DismissedRecommendationEntity> {
  const timestamp = now();
  const row = await prisma.dismissed_recommendations.upsert({
    where: {
      user_id_recommendation_hash: {
        user_id: input.userId,
        recommendation_hash: input.recommendationHash,
      },
    },
    create: {
      id: randomUUID(),
      workspace_id: input.workspaceId,
      user_id: input.userId,
      recommendation_hash: input.recommendationHash,
      accepted: input.accepted,
      accepted_at: input.accepted ? timestamp : null,
      dismissed_at: timestamp,
      created_at: timestamp,
      created_by: input.userId,
      updated_at: timestamp,
      updated_by: input.userId,
      version: 0n,
    },
    update: {
      workspace_id: input.workspaceId,
      accepted: input.accepted,
      accepted_at: input.accepted ? timestamp : null,
      updated_at: timestamp,
      updated_by: input.userId,
    },
  });
  return mapDismissedRecommendation(row);
}

export async function isRecommendationDismissed(
  _workspaceId: string,
  userId: string,
  hash: string,
): Promise<boolean> {
  const row = await prisma.dismissed_recommendations.findFirst({
    where: { user_id: userId, recommendation_hash: hash },
    select: { id: true },
  });
  return row !== null;
}
