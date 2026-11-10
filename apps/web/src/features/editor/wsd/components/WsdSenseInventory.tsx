'use client';

import { useState, useEffect, useCallback, type FormEvent } from 'react';
import {
  Search,
  X,
  Plus,
  ChevronLeft,
  ChevronRight,
  Loader2,
  BookOpen,
  Edit2,
  Trash2,
  Check,
  UploadCloud,
  Download,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { WsdSense } from '@/features/editor/wsd/wsd.contracts';
import {
  createSenseAction,
  deleteSenseAction,
  searchSensesAction,
  updateSenseAction,
} from '@/features/editor/wsd/wsd.actions';
import { WsdImportModal } from './WsdImportModal';

interface WsdSenseInventoryProps {
  workspaceId: string;
  /** Called after any successful create/update/delete so callers can refresh
   *  derived views (e.g. the right-pane sense picker for the selected token). */
  onSensesChanged?: () => void;
}

const PAGE_SIZE = 25;

/**
 * Left-pane sense inventory for the WSD editor:
 * Server-side searched and paginated to smoothly handle 50,000+ senses (e.g. Hemkosh scale).
 * Admins can add / edit / delete senses inline, or bulk import via JSONL/CSV.
 */
export function WsdSenseInventory({ workspaceId, onSensesChanged }: WsdSenseInventoryProps) {
  const [senses, setSenses] = useState<WsdSense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search & Pagination state
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Modal & form states
  const [importOpen, setImportOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newWord, setNewWord] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newGloss, setNewGloss] = useState('');
  const [newExamples, setNewExamples] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Edit sense state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editWord, setEditWord] = useState('');
  const [editLabel, setEditLabel] = useState('');
  const [editGloss, setEditGloss] = useState('');
  const [editExamples, setEditExamples] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Debounce search query input (300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
      setPage(1); // Reset to first page on search query change
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchSenses = useCallback(async (targetPage: number, query: string) => {
    setLoading(true);
    setError(null);
    const result = await searchSensesAction(workspaceId, {
      query: query.trim() || undefined,
      page: targetPage,
      limit: PAGE_SIZE,
    });
    if (result.ok) {
      setSenses(result.data.items);
      setTotal(result.data.total);
      setPage(result.data.page);
      setTotalPages(result.data.totalPages);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => {
    fetchSenses(page, debouncedQuery);
  }, [fetchSenses, page, debouncedQuery]);

  const notifyChanged = useCallback(() => {
    onSensesChanged?.();
  }, [onSensesChanged]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
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
      toast.error(result.error);
      return;
    }
    toast.success(`Added sense for "${result.data.word}"`);
    setNewWord('');
    setNewLabel('');
    setNewGloss('');
    setNewExamples('');
    setAdding(false);
    fetchSenses(1, debouncedQuery);
    notifyChanged();
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
    setSavingEdit(true);
    const result = await updateSenseAction(workspaceId, senseId, {
      word: editWord.trim(),
      senseLabel: editLabel.trim(),
      gloss: editGloss.trim() || null,
      examples: editExamples.trim() || null,
    });
    setSavingEdit(false);
    if (!result.ok) {
      setError(result.error);
      toast.error(result.error);
      return;
    }
    toast.success('Sense updated');
    setSenses(prev => prev.map(s => (s.id === senseId ? result.data : s)));
    setEditingId(null);
    notifyChanged();
  };

  const handleDelete = async (senseId: string, word: string) => {
    if (!confirm(`Delete sense for "${word}"? Senses with active annotations cannot be deleted.`)) {
      return;
    }
    setError(null);
    const result = await deleteSenseAction(workspaceId, senseId);
    if (!result.ok) {
      setError(result.error);
      toast.error(result.error);
      return;
    }
    toast.success('Sense removed');
    fetchSenses(page, debouncedQuery);
    notifyChanged();
  };

  // Group senses by word for current page
  const grouped: Record<string, WsdSense[]> = {};
  for (const s of senses) {
    if (!grouped[s.word]) grouped[s.word] = [];
    grouped[s.word].push(s);
  }
  const words = Object.keys(grouped);

  return (
    <div className="flex flex-col h-full bg-slate-50/50 dark:bg-slate-900/50">
      {/* Header */}
      <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-10 space-y-2.5 shadow-xs">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white tracking-tight">
              Sense Inventory
            </h2>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs font-medium gap-1 text-slate-700 dark:text-slate-300"
              onClick={() => setImportOpen(true)}
              title="Bulk import senses (JSONL/CSV/TSV)"
            >
              <UploadCloud className="w-3.5 h-3.5 text-slate-500" />
              Import
            </Button>
            <Button
              size="sm"
              variant={adding ? 'secondary' : 'default'}
              className="h-7 px-2.5 text-xs font-medium gap-1"
              onClick={() => {
                setAdding(v => !v);
                setError(null);
              }}
            >
              {adding ? (
                <>Close</>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Live Search Bar */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <Input
            placeholder="Search word, label or gloss..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="h-8 pl-8 pr-7 text-xs bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 focus-visible:ring-indigo-500 rounded-md"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Stats bar */}
        <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 px-0.5">
          <span>
            {loading ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Searching...
              </span>
            ) : (
              `${total.toLocaleString()} ${total === 1 ? 'sense' : 'senses'}${
                debouncedQuery ? ' found' : ' total'
              }`
            )}
          </span>
          <span className="inline-flex items-center gap-1.5">
            {totalPages > 1 && (
              <span>
                Page {page} / {totalPages}
              </span>
            )}
            <span className="inline-flex items-center gap-1" title="Download the whole dictionary (re-importable)">
              <Download className="w-3 h-3" />
              <a href={`/api/wsd/${workspaceId}/dictionary?format=jsonl`} download className="underline hover:text-slate-700 dark:hover:text-slate-200">
                JSONL
              </a>
              <a href={`/api/wsd/${workspaceId}/dictionary?format=csv`} download className="underline hover:text-slate-700 dark:hover:text-slate-200">
                CSV
              </a>
            </span>
          </span>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {error && (
          <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-2.5 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Add Sense Form */}
        {adding && (
          <form
            onSubmit={handleCreate}
            className="space-y-2 rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/40 dark:bg-indigo-950/20 p-3 shadow-xs"
          >
            <div className="text-xs font-semibold text-indigo-950 dark:text-indigo-200">
              New Sense Entry
            </div>
            <Input
              placeholder="Word / Headword (e.g. পানী or bank)"
              value={newWord}
              onChange={e => setNewWord(e.target.value)}
              required
              className="h-8 text-xs bg-white dark:bg-slate-900"
            />
            <Input
              placeholder="Sense label (e.g. water-liquid or financial-institution)"
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              required
              className="h-8 text-xs bg-white dark:bg-slate-900"
            />
            <Textarea
              placeholder="Gloss (meaning, optional)"
              value={newGloss}
              onChange={e => setNewGloss(e.target.value)}
              rows={2}
              className="text-xs bg-white dark:bg-slate-900 resize-none"
            />
            <Textarea
              placeholder="Example sentence(s) (optional)"
              value={newExamples}
              onChange={e => setNewExamples(e.target.value)}
              rows={2}
              className="text-xs bg-white dark:bg-slate-900 resize-none"
            />
            <div className="flex gap-2 pt-1">
              <Button
                type="submit"
                size="sm"
                disabled={submitting}
                className="h-7 text-xs flex-1 bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                {submitting ? 'Adding...' : 'Add Sense'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setAdding(false)}
                className="h-7 text-xs"
              >
                Cancel
              </Button>
            </div>
          </form>
        )}

        {/* Loading skeleton or empty states */}
        {loading && senses.length === 0 && (
          <div className="space-y-3 pt-2">
            {[1, 2, 3, 4].map(i => (
              <div
                key={i}
                className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 bg-white dark:bg-slate-900 animate-pulse space-y-2"
              >
                <div className="h-3.5 bg-slate-200 dark:bg-slate-800 rounded w-1/3" />
                <div className="h-3 bg-slate-100 dark:bg-slate-800/60 rounded w-2/3" />
              </div>
            ))}
          </div>
        )}

        {!loading && senses.length === 0 && (
          <div className="text-center py-8 px-2 space-y-2">
            <BookOpen className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
            <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
              {debouncedQuery
                ? `No senses matching "${debouncedQuery}"`
                : 'No senses defined yet.'}
            </p>
            {debouncedQuery && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs mt-1"
                onClick={() => setSearchQuery('')}
              >
                Clear filter
              </Button>
            )}
          </div>
        )}

        {/* Grouped Senses List */}
        {words.map(word => (
          <div key={word} className="space-y-1.5">
            <div className="flex items-center gap-1.5 px-1 pt-1">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                {word}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                ({grouped[word].length})
              </span>
            </div>

            <div className="space-y-1.5">
              {grouped[word].map(sense => {
                const editing = editingId === sense.id;
                return (
                  <div
                    key={sense.id}
                    className="group rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-2.5 transition-all duration-150 hover:border-slate-300 dark:hover:border-slate-700 shadow-xs"
                  >
                    {editing ? (
                      <div className="space-y-2">
                        <Input
                          value={editWord}
                          onChange={e => setEditWord(e.target.value)}
                          placeholder="Word"
                          className="h-7 text-xs"
                        />
                        <Input
                          value={editLabel}
                          onChange={e => setEditLabel(e.target.value)}
                          placeholder="Sense Label"
                          className="h-7 text-xs"
                        />
                        <Textarea
                          value={editGloss}
                          onChange={e => setEditGloss(e.target.value)}
                          placeholder="Gloss (meaning)"
                          rows={2}
                          className="text-xs resize-none"
                        />
                        <Textarea
                          value={editExamples}
                          onChange={e => setEditExamples(e.target.value)}
                          placeholder="Example sentence(s)"
                          rows={2}
                          className="text-xs resize-none"
                        />
                        <div className="flex gap-1.5 pt-1">
                          <Button
                            size="sm"
                            disabled={savingEdit}
                            onClick={() => handleSaveEdit(sense.id)}
                            className="h-6 px-2.5 text-xs gap-1"
                          >
                            <Check className="w-3 h-3" />
                            {savingEdit ? 'Saving...' : 'Save'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingId(null)}
                            className="h-6 px-2 text-xs"
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="inline-block px-1.5 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-900/50 truncate max-w-full">
                            {sense.senseLabel}
                          </div>
                          {sense.gloss && (
                            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                              {sense.gloss}
                            </p>
                          )}
                          {sense.examples && (
                            <p className="text-xs italic text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                              &ldquo;{sense.examples}&rdquo;
                            </p>
                          )}
                        </div>
                        <div className="flex gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity duration-150 shrink-0">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                            onClick={() => startEdit(sense)}
                            title="Edit sense"
                          >
                            <Edit2 className="w-3 h-3" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                            onClick={() => handleDelete(sense.id, sense.word)}
                            title="Delete sense"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer Pagination Bar */}
      {totalPages > 1 && (
        <div className="p-2.5 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between text-xs">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1 || loading}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            className="h-7 px-2 text-xs gap-1"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Prev
          </Button>

          <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
            {page} of {totalPages}
          </span>

          <Button
            size="sm"
            variant="outline"
            disabled={page >= totalPages || loading}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            className="h-7 px-2 text-xs gap-1"
          >
            Next
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      {/* Bulk Importer Modal */}
      <WsdImportModal
        workspaceId={workspaceId}
        open={importOpen}
        onOpenChange={setImportOpen}
        onSuccess={() => {
          fetchSenses(1, debouncedQuery);
          notifyChanged();
        }}
      />
    </div>
  );
}
