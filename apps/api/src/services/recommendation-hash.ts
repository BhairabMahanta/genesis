import { createHash } from "node:crypto";

/**
 * Port of `RecommendationHash`: the `recommendation_hash` dismissal key.
 * `SHA-256hex(TYPE:documentId:entityId)` with nulls as empty strings —
 * stable across re-imports because UUIDs and surface forms survive
 * tokenize/import cycles.
 */
export function hashOf(type: string, documentId: string | null, entityId: string | null): string {
  const input = `${type}:${documentId ?? ""}:${entityId ?? ""}`;
  return createHash("sha256").update(input, "utf8").digest("hex");
}
