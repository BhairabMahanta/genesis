'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { BookOpen, Download, FileSpreadsheet, Plus, Search, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import type { ImportSensesResult, WsdSense } from '@/features/editor/wsd/wsd.contracts';
import {
  createSenseAction,
  deleteSenseAction,
  importSensesAction,
  listSensesAction,
  updateSenseAction,
} from '@/features/editor/wsd/wsd.actions';

interface WsdLexiconProps {
  workspaceId: string;
  isAdmin: boolean;
  /** Called after the dictionary changes so the workspace's progress numbers can refresh. */
  onChanged?: () => void;
}

/**
 * Standalone WSD sense inventory for the workspace page. Unlike the editor
 * sidebar it renders even when the workspace has no documents, and it owns the
 * Excel import / word-list + annotation exports.
 */
export function WsdLexicon({ workspaceId, isAdmin, onChanged }: WsdLexiconProps) {
  const [senses, setSenses] = useState<WsdSense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [adding, setAdding] = useState(false);
  const [newWord, setNewWord] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newGloss, setNewGloss] = useState('');
  const [newExamples, setNewExamples] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editWord, setEditWord] = useState('');
  const [editLabel, setEditLabel] = useState('');
  const [editGloss, setEditGloss] = useState('');
  const [editExamples, setEditExamples] = useState('');

  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSensesResult | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await listSensesAction(workspaceId);
    if (result.ok) setSenses(result.data);
    else setError(result.error);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const result = await listSensesAction(workspaceId);
      if (cancelled) return;
      if (result.ok) setSenses(result.data);
      else setError(result.error);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const groups = useMemo(() => {
    const filtered = senses.filter((sense) => {
      const query = search.trim().toLowerCase();
      if (!query) return true;
      return (
        sense.word.toLowerCase().includes(query) ||
        sense.senseLabel.toLowerCase().includes(query) ||
        (sense.gloss ?? '').toLowerCase().includes(query) ||
        (sense.examples ?? '').toLowerCase().includes(query)
      );
    });

    const byWord = new Map<string, WsdSense[]>();
    for (const sense of filtered) {
      const list = byWord.get(sense.word) ?? [];
      list.push(sense);
      byWord.set(sense.word, list);
    }

    return [...byWord.entries()]
      .map(([word, wordSenses]) => ({
        word,
        senses: [...wordSenses].sort((a, b) =>
          a.senseLabel.localeCompare(b.senseLabel, 'as'),
        ),
      }))
      .sort((a, b) => a.word.localeCompare(b.word, 'as'));
  }, [senses, search]);

  const totalWords = useMemo(
    () => new Set(senses.map((sense) => sense.word)).size,
    [senses],
  );

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!newWord.trim() || !newLabel.trim()) return;
    setSubmitting(true);
    setError(null);
    const result = await createSenseAction(workspaceId, {
      word: newWord.trim(),
      senseLabel: newLabel.trim(),
      gloss: newGloss.trim() || null,
      examples: newExamples.trim() || null,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSenses((prev) => [...prev, result.data]);
    setNewWord('');
    setNewLabel('');
    setNewGloss('');
    setNewExamples('');
    setAdding(false);
    toast.success('Sense added to the inventory.');
    onChanged?.();
  };

  const startEdit = (sense: WsdSense) => {
    setEditingId(sense.id);
    setEditWord(sense.word);
    setEditLabel(sense.senseLabel);
    setEditGloss(sense.gloss ?? '');
    setEditExamples(sense.examples ?? '');
  };

  const handleSaveEdit = async (senseId: string) => {
    setError(null);
    const result = await updateSenseAction(workspaceId, senseId, {
      word: editWord.trim(),
      senseLabel: editLabel.trim(),
      gloss: editGloss.trim() || null,
      examples: editExamples.trim() || null,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSenses((prev) => prev.map((sense) => (sense.id === senseId ? result.data : sense)));
    setEditingId(null);
    toast.success('Sense updated.');
    onChanged?.();
  };

  const handleDelete = async (senseId: string) => {
    if (!confirm('Delete this sense? The backend rejects deletion if annotations reference it.')) {
      return;
    }
    setError(null);
    const result = await deleteSenseAction(workspaceId, senseId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSenses((prev) => prev.filter((sense) => sense.id !== senseId));
    toast.success('Sense deleted.');
    onChanged?.();
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setError(null);
    const formData = new FormData();
    formData.append('file', file);
    const result = await importSensesAction(workspaceId, formData);
    setImporting(false);
    if (event.target) event.target.value = '';
    if (!result.ok) {
      setError(result.error);
      toast.error(result.error);
      return;
    }
    setImportSummary(result.data);
    toast.success(
      `Imported ${result.data.inserted} sense${result.data.inserted === 1 ? '' : 's'}.`,
    );
    await reload();
    onChanged?.();
  };

  const downloadAnnotations = (format: 'csv' | 'xlsx') => {
    window.location.assign(
      `/api/wsd/${workspaceId}/export/annotations?format=${format}`,
    );
  };

  const downloadDictionary = () => {
    window.location.assign(`/api/wsd/${workspaceId}/dictionary?format=csv`);
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
            <BookOpen className="w-7 h-7 text-[var(--primary)]" />
            Sense Inventory
          </h2>
          <p className="text-slate-600 dark:text-slate-400 mt-1">
            Every ambiguous word and sense in this workspace. Annotators can add new
            senses while tagging, so this list grows with the annotation work.
          </p>
          <div className="flex gap-2 mt-3">
            <Badge variant="secondary">{totalWords} words</Badge>
            <Badge variant="secondary">{senses.length} senses</Badge>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <>
              <input
                ref={importInputRef}
                type="file"
                accept=".xls,.xlsx,.xlsm,.csv,.tsv,.json,.jsonl"
                className="hidden"
                onChange={handleImportFile}
              />
              <Button
                variant="outline"
                className="gap-2"
                disabled={importing}
                onClick={() => importInputRef.current?.click()}
              >
                <Upload className="w-4 h-4" />
                {importing ? 'Importing…' : 'Import word list'}
              </Button>
              <Button variant="outline" className="gap-2" onClick={() => setAdding((value) => !value)}>
                <Plus className="w-4 h-4" />
                {adding ? 'Close' : 'Add sense'}
              </Button>
            </>
          )}
          <Button variant="outline" className="gap-2" onClick={() => downloadAnnotations('csv')}>
            <Download className="w-4 h-4" />
            Export annotations
          </Button>
          <Button variant="outline" className="gap-2" onClick={downloadDictionary}>
            <FileSpreadsheet className="w-4 h-4" />
            Export word list
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}

      {importSummary && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
          <p className="font-medium">
            Import finished: {importSummary.inserted} inserted, {importSummary.updated} updated,
            {' '}{importSummary.skipped} skipped.
          </p>
          <p className="mt-1 text-xs">
            {importSummary.totalProcessed} entries processed.
          </p>
        </div>
      )}

      {adding && (
        <form
          onSubmit={handleCreate}
          className="mb-6 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/60"
        >
          <h3 className="font-semibold mb-3">Add a sense manually</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <Input
              placeholder="Assamese ambiguous word"
              value={newWord}
              onChange={(event) => setNewWord(event.target.value)}
              required
            />
            <Input
              placeholder="Sense label (Assamese)"
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
              required
            />
          </div>
          <Textarea
            className="mt-3"
            placeholder="Gloss / English meaning (optional)"
            value={newGloss}
            onChange={(event) => setNewGloss(event.target.value)}
            rows={2}
          />
          <Textarea
            className="mt-2"
            placeholder="Example sentence(s) (optional)"
            value={newExamples}
            onChange={(event) => setNewExamples(event.target.value)}
            rows={2}
          />
          <Button type="submit" className="mt-3" disabled={submitting}>
            {submitting ? 'Adding…' : 'Add sense'}
          </Button>
        </form>
      )}

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          className="pl-9"
          placeholder="Search words, sense labels, glosses, or examples…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {loading && <p className="text-sm text-slate-500">Loading senses…</p>}

      {!loading && senses.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <BookOpen className="w-10 h-10 mx-auto text-slate-400 mb-3" />
          <h3 className="font-semibold text-slate-900 dark:text-white">No senses yet</h3>
          <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
            {isAdmin
              ? 'Import the Assamese ambiguous-word Excel file, add a sense manually, or let annotators add senses while tagging tokens.'
              : 'Annotators can add the first sense for a word from the WSD editor.'}
          </p>
        </div>
      )}

      {!loading && senses.length > 0 && groups.length === 0 && (
        <p className="text-sm text-slate-500">No senses match “{search}”.</p>
      )}

      <div className="space-y-3">
        {groups.map((group) => (
          <div
            key={group.word}
            className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/60"
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-slate-700 dark:bg-slate-800/60">
              <span className="font-semibold text-slate-900 dark:text-white">{group.word}</span>
              <Badge variant="secondary">
                {group.senses.length} sense{group.senses.length === 1 ? '' : 's'}
              </Badge>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {group.senses.map((sense) => {
                const editing = editingId === sense.id;
                return (
                  <div key={sense.id} className="px-4 py-3">
                    {editing ? (
                      <div className="space-y-2">
                        <div className="grid gap-2 md:grid-cols-2">
                          <Input value={editWord} onChange={(event) => setEditWord(event.target.value)} />
                          <Input value={editLabel} onChange={(event) => setEditLabel(event.target.value)} />
                        </div>
                        <Textarea
                          value={editGloss}
                          onChange={(event) => setEditGloss(event.target.value)}
                          rows={2}
                          placeholder="Gloss / English meaning"
                        />
                        <Textarea
                          value={editExamples}
                          onChange={(event) => setEditExamples(event.target.value)}
                          rows={2}
                          placeholder="Example sentence(s)"
                        />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => handleSaveEdit(sense.id)}>
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900 dark:text-white">
                            {sense.senseLabel}
                          </p>
                          {sense.gloss && (
                            <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
                              {sense.gloss}
                            </p>
                          )}
                          {sense.examples && (
                            <p className="mt-0.5 text-sm italic text-slate-500 dark:text-slate-400">
                              {sense.examples}
                            </p>
                          )}
                        </div>
                        {isAdmin && (
                          <div className="flex shrink-0 gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() => startEdit(sense)}
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-red-600 hover:text-red-700"
                              onClick={() => handleDelete(sense.id)}
                            >
                              Delete
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
