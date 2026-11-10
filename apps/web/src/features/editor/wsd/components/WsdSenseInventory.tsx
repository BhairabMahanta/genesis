'use client';

import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { WsdSense } from '@/features/editor/wsd/wsd.contracts';
import {
  createSenseAction,
  deleteSenseAction,
  listSensesAction,
  updateSenseAction,
} from '@/features/editor/wsd/wsd.actions';

interface WsdSenseInventoryProps {
  workspaceId: string;
  /** Only admins can add/edit/delete from the inventory pane. */
  isAdmin: boolean;
  /** Called after any successful create/update/delete so callers can refresh
   *  derived views (e.g. the right-pane sense picker for the selected token). */
  onSensesChanged?: () => void;
  /** Bump this after an inline add from the right pane so the left list reloads. */
  refreshToken?: number;
}

/**
 * Left-pane sense inventory for the WSD editor: lists the workspace's senses
 * grouped by word and lets admins add / edit / delete them inline — the single
 * surface for sense management. Sense mutations are admin-only on the backend;
 * non-admins see the rejection inline.
 */
export function WsdSenseInventory({
  workspaceId,
  isAdmin,
  onSensesChanged,
  refreshToken = 0,
}: WsdSenseInventoryProps) {
  const [senses, setSenses] = useState<WsdSense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [newWord, setNewWord] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editWord, setEditWord] = useState('');
  const [editLabel, setEditLabel] = useState('');
  const [editDescription, setEditDescription] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const result = await listSensesAction(workspaceId);
      if (cancelled) return;
      if (result.ok) setSenses(result.data);
      else setError(result.error);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, refreshToken]);

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
      description: newDescription.trim() || null,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSenses(prev => [...prev, result.data]);
    setNewWord('');
    setNewLabel('');
    setNewDescription('');
    setAdding(false);
    notifyChanged();
  };

  const startEdit = (sense: WsdSense) => {
    setEditingId(sense.id);
    setEditWord(sense.word);
    setEditLabel(sense.senseLabel);
    setEditDescription(sense.description ?? '');
  };

  const handleSaveEdit = async (senseId: string) => {
    setError(null);
    const result = await updateSenseAction(workspaceId, senseId, {
      word: editWord.trim(),
      senseLabel: editLabel.trim(),
      description: editDescription.trim() || null,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSenses(prev => prev.map(s => (s.id === senseId ? result.data : s)));
    setEditingId(null);
    notifyChanged();
  };

  const handleDelete = async (senseId: string) => {
    if (!confirm('Delete this sense? The backend rejects with 409 if annotations reference it.')) {
      return;
    }
    setError(null);
    const result = await deleteSenseAction(workspaceId, senseId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSenses(prev => prev.filter(s => s.id !== senseId));
    notifyChanged();
  };

  const grouped: Record<string, WsdSense[]> = {};
  for (const s of senses) {
    if (!grouped[s.word]) grouped[s.word] = [];
    grouped[s.word].push(s);
  }
  const words = Object.keys(grouped).sort();

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 sticky top-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm z-10">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Sense Inventory</h2>
          {isAdmin && (
            <Button
              size="sm"
              variant={adding ? 'secondary' : 'outline'}
              onClick={() => {
                setAdding(v => !v);
                setError(null);
              }}
            >
              {adding ? 'Close' : '+ Add'}
            </Button>
          )}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          {isAdmin
            ? 'Admins manage the inventory here. Annotators can add a sense from the tagging pane.'
            : 'Read-only here. Add a sense while tagging from the right pane.'}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {error && (
          <div className="rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {isAdmin && adding && (
          <form
            onSubmit={handleCreate}
            className="space-y-2 rounded-lg border border-slate-200 dark:border-slate-700 p-3"
          >
            <Input
              placeholder="Word (e.g. bank)"
              value={newWord}
              onChange={e => setNewWord(e.target.value)}
              required
            />
            <Input
              placeholder="Sense label (e.g. financial-institution)"
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              required
            />
            <Textarea
              placeholder="Description (optional)"
              value={newDescription}
              onChange={e => setNewDescription(e.target.value)}
              rows={2}
            />
            <Button type="submit" size="sm" disabled={submitting} className="w-full">
              {submitting ? 'Adding…' : 'Add sense'}
            </Button>
          </form>
        )}

        {loading && <p className="text-sm text-slate-500 px-1 py-2">Loading senses…</p>}

        {!loading && words.length === 0 && (
          <p className="text-sm text-slate-500 px-1 py-2">No senses defined yet.</p>
        )}

        {!loading && words.map(word => (
          <div key={word}>
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5 px-1">
              {word}
            </div>
            <div className="space-y-1.5">
              {grouped[word].map(sense => {
                const editing = editingId === sense.id;
                return (
                  <div
                    key={sense.id}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 p-2.5"
                  >
                    {editing ? (
                      <div className="space-y-2">
                        <Input value={editWord} onChange={e => setEditWord(e.target.value)} />
                        <Input value={editLabel} onChange={e => setEditLabel(e.target.value)} />
                        <Textarea
                          value={editDescription}
                          onChange={e => setEditDescription(e.target.value)}
                          placeholder="Description"
                          rows={2}
                        />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => handleSaveEdit(sense.id)}>Save</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm text-slate-900 dark:text-white truncate">
                            {sense.senseLabel}
                          </div>
                          {sense.description && (
                            <div className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 line-clamp-2">
                              {sense.description}
                            </div>
                          )}
                        </div>
                        {isAdmin && (
                          <div className="flex gap-1 flex-shrink-0">
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
