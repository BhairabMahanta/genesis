/**
 * `CursorPage<T>` keyset-pagination envelope, carried as the `data` of an
 * `ApiResponse` by high-volume list endpoints (mentions, clusters).
 * Matches the frontend `CursorPage<T>` contract.
 */

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  pageSize: number;
  hasMore: boolean;
}

export function cursorPage<T>(
  items: T[],
  nextCursor: string | null,
  pageSize: number,
): CursorPage<T> {
  return { items, nextCursor, pageSize, hasMore: nextCursor !== null };
}
