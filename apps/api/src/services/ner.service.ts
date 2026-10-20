import { BadRequestException, NotFoundException } from "../common/errors.js";
import {
  BUILTIN_NER_TAGS,
  deleteNerAnnotation,
  deleteNerTag,
  findDocumentById,
  findNerAnnotation,
  listNerAnnotations,
  listNerTags,
  saveNerAnnotation,
  saveNerTag,
  updateNerAnnotation,
} from "../store/prisma.js";
import { requireMember } from "./workspace.service.js";
import type {
  CreateNerAnnotationInput,
  CreateNerTagInput,
  NerAnnotationDto,
  NerTagDefinitionDto,
  UpdateNerAnnotationInput,
} from "../schemas/ner.schemas.js";

function toAnnotationDto(a: {
  id: string;
  documentId: string;
  startTokenIndex: number;
  endTokenIndex: number;
  label: string;
  annotatorId: string;
  createdAt: string;
}): NerAnnotationDto {
  return {
    id: a.id,
    documentId: a.documentId,
    startTokenIndex: a.startTokenIndex,
    endTokenIndex: a.endTokenIndex,
    label: a.label,
    annotatorId: a.annotatorId,
    timestamp: a.createdAt,
  };
}

export async function listTags(workspaceId?: string): Promise<NerTagDefinitionDto[]> {
  const builtins: NerTagDefinitionDto[] = BUILTIN_NER_TAGS.map((t) => ({
    id: null,
    tag: t.tag,
    description: t.description,
    scope: "GLOBAL",
    workspaceId: null,
    builtin: true,
  }));
  const customRows = await listNerTags(workspaceId);
  const customs: NerTagDefinitionDto[] = customRows.map((t) => ({
    id: t.id,
    tag: t.tag,
    description: t.description,
    scope: t.scope,
    workspaceId: t.workspaceId,
    builtin: false,
  }));
  return [...builtins, ...customs];
}

export async function createTag(input: CreateNerTagInput): Promise<NerTagDefinitionDto> {
  const row = await saveNerTag({
    tag: input.tag.toUpperCase(),
    description: input.description ?? null,
    scope: input.scope,
    workspaceId: input.workspaceId ?? null,
    builtin: false,
  });
  return {
    id: row.id,
    tag: row.tag,
    description: row.description,
    scope: row.scope,
    workspaceId: row.workspaceId,
    builtin: false,
  };
}

export async function removeTag(id: string): Promise<void> {
  await deleteNerTag(id);
}

async function workspaceForDocument(documentId: string): Promise<string> {
  const doc = await findDocumentById(documentId);
  if (!doc) throw new NotFoundException("Document not found");
  return doc.workspaceId;
}

export async function listAnnotations(
  documentId: string,
  userId: string,
  annotatorId?: string,
): Promise<NerAnnotationDto[]> {
  const workspaceId = await workspaceForDocument(documentId);
  await requireMember(workspaceId, userId);
  return (await listNerAnnotations(documentId, annotatorId)).map(toAnnotationDto);
}

export async function createAnnotation(
  userId: string,
  input: CreateNerAnnotationInput,
): Promise<NerAnnotationDto> {
  if (input.endTokenIndex < input.startTokenIndex) {
    throw new BadRequestException("endTokenIndex must be >= startTokenIndex");
  }
  const workspaceId = await workspaceForDocument(input.documentId);
  await requireMember(workspaceId, userId);
  const row = await saveNerAnnotation({
    documentId: input.documentId,
    workspaceId,
    startTokenIndex: input.startTokenIndex,
    endTokenIndex: input.endTokenIndex,
    label: input.label.toUpperCase(),
    tagId: null,
    annotatorId: userId,
  });
  return toAnnotationDto(row);
}

export async function updateAnnotation(
  id: string,
  userId: string,
  input: UpdateNerAnnotationInput,
): Promise<NerAnnotationDto> {
  const row = await findNerAnnotation(id);
  if (!row) throw new NotFoundException("Annotation not found");
  await requireMember(row.workspaceId, userId);
  const updated = await updateNerAnnotation(id, {
    ...(input.startTokenIndex !== undefined
      ? { startTokenIndex: input.startTokenIndex }
      : {}),
    ...(input.endTokenIndex !== undefined ? { endTokenIndex: input.endTokenIndex } : {}),
    ...(input.label !== undefined ? { label: input.label.toUpperCase() } : {}),
  });
  if (!updated) throw new NotFoundException("Annotation not found");
  return toAnnotationDto(updated);
}

export async function removeAnnotation(id: string, userId: string): Promise<void> {
  const row = await findNerAnnotation(id);
  if (!row) throw new NotFoundException("Annotation not found");
  await requireMember(row.workspaceId, userId);
  await deleteNerAnnotation(id);
}
