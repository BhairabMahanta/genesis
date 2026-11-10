import type { WsdRejection } from '@/features/editor/wsd/wsd.contracts';

/** Tokens worth checking against the dictionary: anything with a letter or digit (skips punctuation). */
export function isWordLike(form: string): boolean {
  return /[\p{L}\p{N}]/u.test(form);
}

/** tokenId -> ids of the senses the annotator crossed out on it. */
export function groupRejectionsByToken(rejections: WsdRejection[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of rejections) (out[r.tokenId] ??= []).push(r.senseId);
  return out;
}
