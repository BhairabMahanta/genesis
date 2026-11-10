'use client';

import { useEffect, useRef } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { WsdAnnotation } from '@/features/editor/wsd/wsd.contracts';

export interface CompletedEntry {
  annotation: WsdAnnotation;
  /** Sentence text around the word when that part of the document is loaded. */
  snippet: string | null;
  /** False when the token's page isn't loaded yet, so there is nothing to scroll to. */
  navigable: boolean;
}

interface WsdCompletedLogProps {
  entries: CompletedEntry[];
  selectedTokenId: string | null;
  onSelect: (tokenId: string) => void;
}

/** Left-pane running list of the words the annotator has already disambiguated. */
export function WsdCompletedLog({ entries, selectedTokenId, onSelect }: WsdCompletedLogProps) {
  const endRef = useRef<HTMLDivElement>(null);

  // New entries are appended at the bottom; keep the latest in view.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [entries.length]);

  if (entries.length === 0) {
    return (
      <p className="text-sm text-slate-500 px-1 py-4">
        Nothing resolved yet. Click a highlighted word, then press ✓ on the sense that fits.
      </p>
    );
  }

  return (
    <div>
      <ol className="space-y-1.5">
      {entries.map(({ annotation, snippet, navigable }) => {
        const active = annotation.tokenId === selectedTokenId;
        return (
          <li key={annotation.id}>
            <button
              type="button"
              disabled={!navigable}
              onClick={() => onSelect(annotation.tokenId)}
              className={`w-full text-left rounded-lg border p-2.5 transition ${
                active
                  ? 'border-[var(--primary)] bg-indigo-50 dark:bg-indigo-950/40'
                  : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50'
              } ${navigable ? '' : 'cursor-default opacity-80'}`}
            >
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                <span className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                  {annotation.tokenForm ?? '—'}
                </span>
                <span className="text-xs text-green-700 dark:text-green-400 truncate">
                  {annotation.senseLabel ?? annotation.senseId}
                </span>
              </div>
              <div className="text-[11px] text-slate-500 mt-1 truncate">
                {annotation.sentenceIndex != null ? `Sentence ${annotation.sentenceIndex + 1}` : 'Sentence —'}
                {snippet ? ` · ${snippet}` : ''}
              </div>
            </button>
          </li>
        );
      })}
      </ol>
      <div ref={endRef} />
    </div>
  );
}
