import { BadRequestException, NotFoundException } from "../common/errors.js";
import {
  BUILTIN_NER_TAGS,
  countTokens,
  deleteNerAnnotation,
  deleteNerTag,
  findDocumentById,
  findNerAnnotation,
  findNerTagById,
  findNerTagDefinition,
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

const TAG_PATTERN = /^[A-Z][A-Z0-9_]{0,19}$/;

function validationError(field: string, message: string): BadRequestException {
  return new BadRequestException("Validation failed", { [field]: [message] });
}

function normalizeTag(value: string): string {
  return value.trim().toUpperCase();
}

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

export async function createTag(
  userId: string,
  input: CreateNerTagInput,
): Promise<NerTagDefinitionDto> {
  const tag = normalizeTag(input.tag);
  if (!TAG_PATTERN.test(tag)) {
    throw validationError(
      "tag",
      "Tag must start with an uppercase letter and contain only A-Z, 0-9, underscore (max 20 chars)",
    );
  }
  if (BUILTIN_NER_TAGS.some((builtin) => builtin.tag === tag)) {
    throw validationError("tag", `Tag conflicts with a built-in OntoNotes tag: ${tag}`);
  }

  const scope = input.scope;
  let workspaceId: string | null = null;
  if (scope === "WORKSPACE") {
    if (!input.workspaceId) {
      throw validationError("workspaceId", "workspaceId is required when scope=WORKSPACE");
    }
    await requireMember(input.workspaceId, userId);
    workspaceId = input.workspaceId;
  }

  if (await findNerTagDefinition(tag, scope, workspaceId)) {
    throw validationError(
      "tag",
      scope === "GLOBAL"
        ? `Global tag already exists: ${tag}`
        : `Tag already exists in this workspace: ${tag}`,
    );
  }

  const row = await saveNerTag({
    tag,
    description: input.description ?? null,
    scope,
    workspaceId,
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
  if (!(await findNerTagById(id))) {
    throw new NotFoundException("NER tag definition not found");
  }
  await deleteNerTag(id);
}

async function workspaceForDocument(documentId: string): Promise<string> {
  const doc = await findDocumentById(documentId);
  if (!doc) throw new NotFoundException("Document not found");
  return doc.workspaceId;
}

async function effectiveTags(workspaceId: string): Promise<Set<string>> {
  const custom = await listNerTags(workspaceId);
  return new Set([
    ...BUILTIN_NER_TAGS.map((tag) => tag.tag),
    ...custom.map((tag) => tag.tag),
  ]);
}

async function validateSpan(
  documentId: string,
  startTokenIndex: number,
  endTokenIndex: number,
): Promise<void> {
  if (endTokenIndex < startTokenIndex) {
    throw validationError("endTokenIndex", "endTokenIndex must be >= startTokenIndex");
  }
  const tokenCount = await countTokens(documentId);
  if (endTokenIndex >= tokenCount) {
    throw validationError(
      "endTokenIndex",
      `endTokenIndex ${endTokenIndex} is out of document bounds (token count: ${tokenCount})`,
    );
  }
}

async function validateLabel(workspaceId: string, value: string): Promise<string> {
  const label = normalizeTag(value);
  if (!label) {
    throw validationError("label", "label is required");
  }
  if (!(await effectiveTags(workspaceId)).has(label)) {
    throw validationError("label", `Invalid NER label for this workspace: ${label}`);
  }
  return label;
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
  const workspaceId = await workspaceForDocument(input.documentId);
  await requireMember(workspaceId, userId);
  await validateSpan(input.documentId, input.startTokenIndex, input.endTokenIndex);
  const label = await validateLabel(workspaceId, input.label);

  const row = await saveNerAnnotation({
    documentId: input.documentId,
    workspaceId,
    startTokenIndex: input.startTokenIndex,
    endTokenIndex: input.endTokenIndex,
    label,
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

  const startTokenIndex = input.startTokenIndex ?? row.startTokenIndex;
  const endTokenIndex = input.endTokenIndex ?? row.endTokenIndex;
  await validateSpan(row.documentId, startTokenIndex, endTokenIndex);
  const label = await validateLabel(
    row.workspaceId,
    input.label !== undefined ? input.label : row.label,
  );

  const updated = await updateNerAnnotation(id, {
    startTokenIndex,
    endTokenIndex,
    label,
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
