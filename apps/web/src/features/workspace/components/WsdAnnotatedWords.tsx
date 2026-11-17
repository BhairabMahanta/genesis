'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Download, ListChecks, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getAnnotatedOverviewAction } from '@/features/editor/wsd/wsd.actions';
import type { WsdAnnotatedOverview } from '@/features/editor/wsd/wsd.contracts';

interface WsdAnnotatedWordsProps {
  workspaceId: string;
  onAnnotate: () => void;
}

// Rows rendered at a time; a full corpus can hold thousands of annotations.
const PAGE = 200;

const SELECT_CLASS =
  'h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200';

/** The sentence with the annotated word marked, so the reader sees the context it was tagged in. */
function highlight(sentence: string, word: string): ReactNode {
  const at = sentence.toLowerCase().indexOf(word.toLowerCase());
  if (!sentence || at < 0) return sentence || '—';
  return (
    <>
      {sentence.slice(0, at)}
      <mark className="rounded bg-amber-200/80 px-0.5 text-slate-900 dark:bg-amber-500/40 dark:text-white">
        {sentence.slice(at, at + word.length)}
      </mark>
      {sentence.slice(at + word.length)}
    </>
  );
}

/**
 * Workspace-wide view of the WSD work: for every ambiguous word that occurs in
 * the documents, how many occurrences are tagged, and every annotation with its
 * sentence, chosen sense and annotator.
 */
export function WsdAnnotatedWords({ workspaceId, onAnnotate }: WsdAnnotatedWordsProps) {
  const [data, setData] = useState<WsdAnnotatedOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [wordQuery, setWordQuery] = useState('');
  const [selectedWord, setSelectedWord] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState('all');
  const [annotatorId, setAnnotatorId] = useState('all');
  const [search, setSearch] = useState('');
  const [visible, setVisible] = useState(PAGE);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getAnnotatedOverviewAction(workspaceId);
    if (result.ok) {
      setData(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(() => {
    const words = data?.words ?? [];
    return {
      occurrences: words.reduce((sum, w) => sum + w.occurrences, 0),
      tagged: words.reduce((sum, w) => sum + w.tagged, 0),
    };
  }, [data]);

  const documents = useMemo(() => {
    const seen = new Map<string, string>();
    for (const a of data?.annotations ?? []) seen.set(a.documentId, a.documentName);
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [data]);

  const annotators = useMemo(() => {
    const seen = new Map<string, string>();
    for (const a of data?.annotations ?? []) seen.set(a.annotatorId, a.annotatorName);
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [data]);

  const words = useMemo(() => {
    const q = wordQuery.trim().toLowerCase();
    return (data?.words ?? []).filter(w => !q || w.word.toLowerCase().includes(q));
  }, [data, wordQuery]);

  const annotations = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.annotations ?? []).filter(
      a =>
        (!selectedWord || a.word.toLowerCase() === selectedWord) &&
        (documentId === 'all' || a.documentId === documentId) &&
        (annotatorId === 'all' || a.annotatorId === annotatorId) &&
        (!q ||
          a.word.toLowerCase().includes(q) ||
          a.senseLabel.toLowerCase().includes(q) ||
          (a.senseGloss ?? '').toLowerCase().includes(q) ||
          a.sentenceText.toLowerCase().includes(q)),
    );
  }, [data, selectedWord, documentId, annotatorId, search]);

  // A new filter starts the list from the top.
  useEffect(() => {
    setVisible(PAGE);
  }, [selectedWord, documentId, annotatorId, search]);

  const filtered = Boolean(selectedWord) || documentId !== 'all' || annotatorId !== 'all' || Boolean(search.trim());
  const clearFilters = () => {
    setSelectedWord(null);
    setDocumentId('all');
    setAnnotatorId('all');
    setSearch('');
  };

  const pct = (tagged: number, occurrences: number) =>
    occurrences === 0 ? 0 : Math.round((tagged * 1000) / occurrences) / 10;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
            <ListChecks className="w-7 h-7 text-[var(--primary)]" />
            Annotated Words
          </h2>
          <p className="text-slate-600 dark:text-slate-400 mt-1">
            Every ambiguous word found in the documents, how many of its occurrences are tagged,
            and the sense chosen in each sentence.
          </p>
          {data && (
            <div className="flex flex-wrap gap-2 mt-3">
              <Badge variant="secondary">
                {totals.tagged} of {totals.occurrences} occurrences tagged ({pct(totals.tagged, totals.occurrences)}%)
              </Badge>
              <Badge variant="secondary">
                {data.words.length} of {data.dictionaryWords} dictionary words appear in the documents
              </Badge>
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-2" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => window.location.assign(`/api/wsd/${workspaceId}/export/annotations?format=csv`)}
          >
            <Download className="w-4 h-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}

      {loading && !data && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading annotated words…
        </p>
      )}

      {data && data.dictionaryWords === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
          No ambiguous-word list yet. Import one from <strong>Sense Inventory</strong>, then the words it finds in the
          documents appear here.
        </p>
      )}

      {data && data.dictionaryWords > 0 && (
        <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          {/* Per-word coverage */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/60">
            <h3 className="font-semibold text-slate-900 dark:text-white">By word</h3>
            <p className="text-xs text-slate-500 mt-0.5">Tagged / occurrences. Click a word to filter.</p>
            <div className="relative mt-3">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <Input
                value={wordQuery}
                onChange={e => setWordQuery(e.target.value)}
                placeholder="Find a word"
                className="h-8 pl-8 text-sm"
              />
            </div>
            {data.words.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                None of the {data.dictionaryWords} dictionary words occur in the documents yet.
              </p>
            ) : (
              <ul className="mt-3 -mx-1 max-h-[32rem] space-y-1 overflow-y-auto p-1">
                {words.map(w => {
                  const active = selectedWord === w.word.toLowerCase();
                  const done = w.tagged >= w.occurrences;
                  return (
                    <li key={w.word}>
                      <button
                        type="button"
                        onClick={() => setSelectedWord(active ? null : w.word.toLowerCase())}
                        aria-pressed={active}
                        className={`w-full rounded-lg px-3 py-2 text-left transition ${
                          active
                            ? 'bg-indigo-50 ring-2 ring-inset ring-[var(--primary)] dark:bg-indigo-950/40'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-medium text-slate-900 dark:text-white truncate">{w.word}</span>
                          <span
                            className={`text-xs tabular-nums ${done ? 'text-emerald-600' : 'text-slate-500'}`}
                          >
                            {w.tagged}/{w.occurrences}
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-emerald-500"
                            style={{ width: `${pct(w.tagged, w.occurrences)}%` }}
                          />
                        </div>
                      </button>
                    </li>
                  );
                })}
                {words.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No word matches.</li>}
              </ul>
            )}
          </section>

          {/* Every annotation */}
          <section className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <div className="relative flex-1 min-w-[12rem]">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <Input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search word, sense, gloss or sentence"
                  className="h-9 pl-8 text-sm"
                />
              </div>
              {documents.length > 1 && (
                <select
                  aria-label="Filter by document"
                  value={documentId}
                  onChange={e => setDocumentId(e.target.value)}
                  className={SELECT_CLASS}
                >
                  <option value="all">All documents</option>
                  {documents.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              )}
              {annotators.length > 1 && (
                <select
                  aria-label="Filter by annotator"
                  value={annotatorId}
                  onChange={e => setAnnotatorId(e.target.value)}
                  className={SELECT_CLASS}
                >
                  <option value="all">All annotators</option>
                  {annotators.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex items-center justify-between text-xs text-slate-500 mb-3">
              <span>
                Showing {Math.min(visible, annotations.length)} of {annotations.length} annotation
                {annotations.length === 1 ? '' : 's'}
                {selectedWord && (
                  <>
                    {' '}for <strong className="text-slate-700 dark:text-slate-300">{selectedWord}</strong>
                  </>
                )}
              </span>
              {filtered && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200"
                >
                  <X className="w-3 h-3" /> Clear filters
                </button>
              )}
            </div>

            {data.annotations.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center dark:border-slate-700">
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Nothing annotated yet. Open the editor, click a highlighted word and press ✓ on the sense that fits.
                </p>
                <Button className="mt-3" onClick={onAnnotate}>
                  Open editor
                </Button>
              </div>
            ) : annotations.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500 dark:border-slate-700">
                No annotations match these filters.
              </p>
            ) : (
              <ul className="space-y-2">
                {annotations.slice(0, visible).map(a => (
                  <li
                    key={a.id}
                    className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/60"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="text-lg font-semibold text-slate-900 dark:text-white">{a.word}</span>
                      <span className="rounded-md border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-sm font-medium text-indigo-700 dark:border-indigo-900/60 dark:bg-indigo-950/50 dark:text-indigo-300">
                        {a.senseLabel}
                      </span>
                      {a.senseGloss && (
                        <span className="text-sm text-slate-600 dark:text-slate-400">{a.senseGloss}</span>
                      )}
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                      {highlight(a.sentenceText, a.word)}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      {a.documentName} · Sentence {a.sentenceIndex + 1} · {a.annotatorName} ·{' '}
                      {new Date(a.timestamp).toLocaleDateString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            {annotations.length > visible && (
              <div className="mt-4 text-center">
                <Button variant="outline" onClick={() => setVisible(v => v + PAGE)}>
                  Show {Math.min(PAGE, annotations.length - visible)} more
                </Button>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
