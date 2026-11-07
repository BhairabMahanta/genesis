'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Check, X } from 'lucide-react';
import { useAuth } from '@/features/auth/auth.provider';
import type {
  WorkspaceEditorResponse,
  DocumentContentResponse,
  TokenDto,
} from '@/features/editor/core/editor.contracts';
import type { WsdSense, WsdAnnotation } from '@/features/editor/wsd/wsd.contracts';
import {
  getDocumentContentAction,
  getEditorDocumentsAction,
  getEditorSessionAction,
  saveEditorSessionAction,
} from '@/features/editor/core/editor.actions';
import {
  createSenseAction,
  deleteAnnotationAction,
  listAnnotationsForDocumentAction,
  listRejectionsForDocumentAction,
  listSensesAction,
  matchAmbiguousWordsAction,
  rejectSenseAction,
  unrejectSenseAction,
  upsertAnnotationAction,
} from '@/features/editor/wsd/wsd.actions';
import { updateDocumentStatusAction } from '@/features/document/document.actions';
import { useEditorSession } from '@/features/editor/core/hooks/useEditorSession';
import { usePaginatedDocument, EDITOR_PAGE_SIZE } from '@/features/editor/core/hooks/usePaginatedDocument';
import { EditorLoadMore } from '@/features/editor/core/components/EditorLoadMore';
import { DocumentSwitcher } from '@/features/editor/core/components/DocumentSwitcher';
import { EditorHelpPanel } from '@/features/editor/core/components/EditorHelpPanel';
import { DisagreementDots } from '@/features/editor/core/components/DisagreementDots';
import { WsdSenseInventory } from '@/features/editor/wsd/components/WsdSenseInventory';
import { WsdAddSenseForm, type NewSenseValues } from '@/features/editor/wsd/components/WsdAddSenseForm';
import { WsdRegisterWordDialog } from '@/features/editor/wsd/components/WsdRegisterWordDialog';
import { WsdCompletedLog, type CompletedEntry } from '@/features/editor/wsd/components/WsdCompletedLog';
import { groupRejectionsByToken, isWordLike } from '@/features/editor/wsd/wsd.utils';
import { FullScreenLoader } from '@/components/Spinner';
import { buildEditorData, groupAnnotationsByToken } from '@/features/editor/core/editor.utils';
import { toast } from 'sonner';

interface WsdEditorProps {
  workspaceId: string;
  workspaceName: string;
}

export default function WsdEditor({ workspaceId, workspaceName }: WsdEditorProps) {
  const router = useRouter();
  const { user } = useAuth();
  const currentUser = user?.id ?? null;

  // API data state
  const [editorData, setEditorData] = useState<WorkspaceEditorResponse | null>(null);
  const [documentContent, setDocumentContent] = useState<DocumentContentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [currentDocIndex, setCurrentDocIndex] = useState(0);
  const [selectedToken, setSelectedToken] = useState<TokenDto | null>(null);
  const [senses, setSenses] = useState<WsdSense[]>([]);
  const [sensesLoading, setSensesLoading] = useState(false);
  const [senseFilter, setSenseFilter] = useState('');

  // The workspace's ambiguous-word list as it applies to this text: lowercased form -> sense count.
  const [ambiguous, setAmbiguous] = useState<Map<string, number>>(new Map());
  const checkedFormsRef = useRef<Set<string>>(new Set());
  const [dictVersion, setDictVersion] = useState(0);
  const dictVersionRef = useRef(0);
  // Senses the annotator crossed out (✗) per token. Persisted server-side, private to each annotator.
  const [rejected, setRejected] = useState<Record<string, string[]>>({});
  const [registerOpen, setRegisterOpen] = useState(false);
  const [leftTab, setLeftTab] = useState('completed');

  // tokenId → all annotations on that token, across annotators. Pre-loaded per
  // document so existing tags show on open (not just after clicking a token).
  const [annotationsByToken, setAnnotationsByToken] = useState<Record<string, WsdAnnotation[]>>({});

  const { saveSession, containerRef, lastScrollRef, handleScroll } = useEditorSession({
    workspaceId,
    currentDocIndex,
    editorData,
    loading,
  });

  // Load workspace + first document on mount, restoring any saved session.
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);

      const docsResult = await getEditorDocumentsAction(workspaceId);
      if (cancelled) return;
      if (!docsResult.ok) {
        setError(docsResult.error);
        setLoading(false);
        return;
      }
      const documents = docsResult.data;

      let savedSession = null;
      let initialDocIndex = 0;
      const sessionResult = await getEditorSessionAction(workspaceId);
      if (sessionResult.ok && sessionResult.data) {
        savedSession = sessionResult.data;
        if (savedSession.lastDocumentIndex < documents.length) {
          initialDocIndex = savedSession.lastDocumentIndex;
        }
      }

      if (cancelled) return;
      setEditorData(buildEditorData(workspaceId, workspaceName, 'WSD', documents, savedSession));

      if (documents.length > 0) {
        const doc = documents[initialDocIndex];
        setCurrentDocIndex(initialDocIndex);

        if (doc.isTokenized && doc.tokenCount > 0) {
          const contentResult = await getDocumentContentAction(workspaceId, doc.id, 0, EDITOR_PAGE_SIZE);
          if (!cancelled && contentResult.ok) {
            setDocumentContent(contentResult.data);

            const annResult = await listAnnotationsForDocumentAction(workspaceId, doc.id);
            const rejResult = await listRejectionsForDocumentAction(workspaceId, doc.id);
            if (!cancelled) {
              setAnnotationsByToken(annResult.ok ? groupAnnotationsByToken(annResult.data) : {});
              setRejected(rejResult.ok ? groupRejectionsByToken(rejResult.data) : {});
            }

            if (savedSession?.scrollPosition) {
              setTimeout(() => {
                if (containerRef.current) {
                  containerRef.current.scrollTop = savedSession.scrollPosition;
                  lastScrollRef.current = savedSession.scrollPosition;
                }
              }, 500);
            }
          }
        }
      }

      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, workspaceName, containerRef, lastScrollRef]);

  // Load a document's content + all its annotations when switching.
  const loadDocumentContent = useCallback(
    async (docIndex: number) => {
      if (!editorData || docIndex < 0 || docIndex >= editorData.documents.length) return;

      const scrollPos = containerRef.current?.scrollTop || 0;
      // Session save is best-effort; ignore its result.
      await saveEditorSessionAction({
        workspaceId,
        lastDocumentIndex: docIndex,
        scrollPosition: scrollPos,
      });

      setSelectedToken(null);
      setSenses([]);
      setSenseFilter('');
      setAnnotationsByToken({});
      setRejected({});

      const doc = editorData.documents[docIndex];
      setCurrentDocIndex(docIndex);

      if (!doc.isTokenized || doc.tokenCount === 0) {
        setDocumentContent(null);
        return;
      }

      const contentResult = await getDocumentContentAction(workspaceId, doc.id, 0, EDITOR_PAGE_SIZE);
      if (!contentResult.ok) {
        toast.error(contentResult.error || 'Failed to load document');
        return;
      }
      setDocumentContent(contentResult.data);

      const annResult = await listAnnotationsForDocumentAction(workspaceId, doc.id);
      setAnnotationsByToken(annResult.ok ? groupAnnotationsByToken(annResult.data) : {});
      const rejResult = await listRejectionsForDocumentAction(workspaceId, doc.id);
      setRejected(rejResult.ok ? groupRejectionsByToken(rejResult.data) : {});
    },
    [editorData, workspaceId, containerRef],
  );

  // Forget what we know about the dictionary and re-check the loaded text (after import / edits).
  const refreshDictionary = useCallback(() => {
    checkedFormsRef.current.clear();
    dictVersionRef.current += 1;
    setAmbiguous(new Map());
    setDictVersion(dictVersionRef.current);
  }, []);

  // Auto-scan: check each new token form against the ambiguous-word list so matches highlight.
  const loadedTokens = documentContent?.tokens;
  useEffect(() => {
    if (!loadedTokens) return;
    const fresh = [...new Set(loadedTokens.map(t => t.form).filter(isWordLike))].filter(
      f => !checkedFormsRef.current.has(f.toLowerCase()),
    );
    if (fresh.length === 0) return;
    fresh.forEach(f => checkedFormsRef.current.add(f.toLowerCase()));
    const version = dictVersionRef.current;
    (async () => {
      for (let i = 0; i < fresh.length; i += 1000) {
        const chunk = fresh.slice(i, i + 1000);
        const res = await matchAmbiguousWordsAction(workspaceId, chunk);
        if (version !== dictVersionRef.current) return;
        if (!res.ok) {
          chunk.forEach(f => checkedFormsRef.current.delete(f.toLowerCase()));
          toast.error(res.error || 'Could not check the ambiguous-word list');
          return;
        }
        setAmbiguous(prev => {
          const next = new Map(prev);
          for (const m of res.data) next.set(m.word.toLowerCase(), m.senseCount);
          return next;
        });
      }
    })();
  }, [loadedTokens, workspaceId, dictVersion]);

  const isAmbiguous = useCallback((form: string) => ambiguous.has(form.toLowerCase()), [ambiguous]);

  const pagination = usePaginatedDocument({
    workspaceId,
    documentContent,
    setDocumentContent,
    scrollRootRef: containerRef,
  });

  // Select a token and load its word's sense inventory into the right pane.
  const selectToken = useCallback(
    async (token: TokenDto) => {
      setSelectedToken(token);
      setSenseFilter('');
      setSensesLoading(true);
      const sensesResult = await listSensesAction(workspaceId, token.form);
      setSensesLoading(false);
      setSenses(sensesResult.ok ? sensesResult.data : []);
    },
    [workspaceId],
  );

  const handleTokenClick = useCallback(
    (token: TokenDto) => {
      if (selectedToken?.id === token.id) {
        // Clicking the selected token again deselects it.
        setSelectedToken(null);
        setSenses([]);
        return;
      }
      selectToken(token);
    },
    [selectedToken, selectToken],
  );

  // Reload the selected token's senses after the inventory changes, so the
  // right-pane picker reflects added/edited/deleted senses without a click.
  const reloadSensesForSelected = useCallback(() => {
    if (selectedToken) selectToken(selectedToken);
  }, [selectedToken, selectToken]);

  // Move to the next / previous highlighted (ambiguous) word. With nothing selected,
  // anchors on the first / last one: the keyboard-only entry point.
  const stepAmbiguous = useCallback(
    (direction: 1 | -1) => {
      const tokens = documentContent?.tokens;
      if (!tokens || tokens.length === 0) return;
      const from = selectedToken
        ? tokens.findIndex(t => t.id === selectedToken.id)
        : direction === 1
          ? -1
          : tokens.length;
      for (let i = from + direction; i >= 0 && i < tokens.length; i += direction) {
        if (isAmbiguous(tokens[i].form)) {
          selectToken(tokens[i]);
          return;
        }
      }
    },
    [documentContent, selectedToken, selectToken, isAmbiguous],
  );
  const advanceToNextToken = useCallback(() => stepAmbiguous(1), [stepAmbiguous]);
  const moveToPrevToken = useCallback(() => stepAmbiguous(-1), [stepAmbiguous]);

  const getMyAnnotation = useCallback(
    (tokenId: string): WsdAnnotation | undefined => {
      if (!currentUser) return undefined;
      return (annotationsByToken[tokenId] ?? []).find(a => a.annotatorId === currentUser);
    },
    [annotationsByToken, currentUser],
  );

  // Annotations from OTHER annotators (for disagreement dots).
  const getOtherAnnotations = (tokenId: string): WsdAnnotation[] => {
    const all = annotationsByToken[tokenId] ?? [];
    if (!currentUser) return all;
    return all.filter(a => a.annotatorId !== currentUser);
  };

  // ✓: save the word-sense mapping for this occurrence. Returns whether it saved.
  const confirmSense = useCallback(
    async (token: TokenDto, sense: WsdSense): Promise<boolean> => {
      const result = await upsertAnnotationAction(workspaceId, token.id, sense.id);
      if (!result.ok) {
        toast.error(result.error || 'Failed to tag token');
        return false;
      }
      // Carry label / word / sentence so the inline tag and the Completed log render immediately
      // (the upsert response doesn't resolve them server-side).
      const saved: WsdAnnotation = {
        ...result.data,
        senseLabel: sense.senseLabel,
        tokenForm: token.form,
        sentenceIndex: token.sentenceIndex,
      };
      setAnnotationsByToken(prev => {
        const others = (prev[token.id] ?? []).filter(a => a.annotatorId !== saved.annotatorId);
        return { ...prev, [token.id]: [...others, saved] };
      });
      setRejected(prev => ({ ...prev, [token.id]: (prev[token.id] ?? []).filter(id => id !== sense.id) }));
      return true;
    },
    [workspaceId],
  );

  const handlePickSense = useCallback(
    async (sense: WsdSense) => {
      if (!selectedToken) return;
      if (await confirmSense(selectedToken, sense)) advanceToNextToken();
    },
    [selectedToken, confirmSense, advanceToNextToken],
  );

  // Create a sense for the selected occurrence ("Add New" or registering an unlisted word),
  // add its word to the ambiguous list so it highlights, and confirm it here.
  const createSenseForSelected = useCallback(
    async (values: NewSenseValues): Promise<string | null> => {
      if (!selectedToken) return 'Select a word first.';
      const result = await createSenseAction(workspaceId, {
        word: values.word,
        senseLabel: values.senseLabel,
        gloss: values.gloss.trim() || null,
        examples: values.examples.trim() || null,
      });
      if (!result.ok) return result.error || 'Failed to add sense.';
      const created = result.data;
      const key = created.word.toLowerCase();
      checkedFormsRef.current.add(key);
      setAmbiguous(prev => new Map(prev).set(key, (prev.get(key) ?? 0) + 1));
      if (key === selectedToken.form.toLowerCase()) setSenses(prev => [...prev, created]);
      setRegisterOpen(false);
      if (await confirmSense(selectedToken, created)) advanceToNextToken();
      return null;
    },
    [selectedToken, workspaceId, confirmSense, advanceToNextToken],
  );

  const clearSelectedTokenAnnotation = useCallback(async () => {
    if (!selectedToken) return;
    const mine = getMyAnnotation(selectedToken.id);
    if (!mine) return;
    const tokenId = selectedToken.id;
    const result = await deleteAnnotationAction(workspaceId, mine.id);
    if (!result.ok) {
      toast.error(result.error || 'Failed to remove annotation');
      return;
    }
    setAnnotationsByToken(prev => {
      const remaining = (prev[tokenId] ?? []).filter(a => a.id !== mine.id);
      const next = { ...prev };
      if (remaining.length === 0) delete next[tokenId];
      else next[tokenId] = remaining;
      return next;
    });
  }, [selectedToken, getMyAnnotation, workspaceId]);

  // ✗ (persisted per annotator): this sense doesn't fit here. Click again to undo. The server
  // also drops your ✓ if it was on this sense.
  const handleRejectSense = useCallback(
    async (sense: WsdSense) => {
      if (!selectedToken) return;
      const tokenId = selectedToken.id;
      const already = (rejected[tokenId] ?? []).includes(sense.id);
      const result = already
        ? await unrejectSenseAction(workspaceId, tokenId, sense.id)
        : await rejectSenseAction(workspaceId, tokenId, sense.id);
      if (!result.ok) {
        toast.error(result.error || 'Failed to update rejection');
        return;
      }
      setRejected(prev => {
        const current = prev[tokenId] ?? [];
        return { ...prev, [tokenId]: already ? current.filter(id => id !== sense.id) : [...current, sense.id] };
      });
      const mine = getMyAnnotation(tokenId);
      if (!already && mine?.senseId === sense.id) {
        setAnnotationsByToken(prev => {
          const remaining = (prev[tokenId] ?? []).filter(a => a.id !== mine.id);
          const next = { ...prev };
          if (remaining.length === 0) delete next[tokenId];
          else next[tokenId] = remaining;
          return next;
        });
      }
    },
    [selectedToken, rejected, workspaceId, getMyAnnotation],
  );

  // The Dictionary tab changed the inventory: re-run highlighting and refresh the open word.
  const handleDictionaryChanged = useCallback(() => {
    refreshDictionary();
    reloadSensesForSelected();
  }, [refreshDictionary, reloadSensesForSelected]);

  const filteredSenses = senses.filter(s => {
    if (!senseFilter.trim()) return true;
    const q = senseFilter.toLowerCase();
    return s.word.toLowerCase().includes(q) || s.senseLabel.toLowerCase().includes(q);
  });

  // Toggle the current document's complete status, auto-advancing on complete.
  const toggleComplete = useCallback(async () => {
    if (!editorData) return;
    const doc = editorData.documents[currentDocIndex];
    if (!doc) return;
    const newStatus = doc.status === 'COMPLETE' ? 'ANNOTATING' : 'COMPLETE';
    const result = await updateDocumentStatusAction(doc.id, newStatus);
    if (!result.ok) {
      toast.error(result.error || 'Failed to update document status');
      return;
    }
    const newDocs = [...editorData.documents];
    newDocs[currentDocIndex] = { ...doc, status: newStatus };
    setEditorData({ ...editorData, documents: newDocs });

    if (newStatus === 'COMPLETE') {
      if (currentDocIndex < editorData.documents.length - 1) {
        loadDocumentContent(currentDocIndex + 1);
      } else {
        toast.success('All documents complete 🎉');
      }
    }
  }, [editorData, currentDocIndex, loadDocumentContent]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't hijack typing in the sense-search box.
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (registerOpen) return;

      // Mark complete & advance — ⌘/Ctrl+Enter.
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        toggleComplete();
        return;
      }

      // Everything below is a bare key — bail if a modifier is held.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'Escape') {
        setSelectedToken(null);
        setSenses([]);
        return;
      }

      if (e.key === '[') {
        e.preventDefault();
        loadDocumentContent(currentDocIndex - 1);
        return;
      }
      if (e.key === ']') {
        e.preventDefault();
        loadDocumentContent(currentDocIndex + 1);
        return;
      }

      if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) {
        e.preventDefault();
        advanceToNextToken();
        return;
      }
      if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) {
        e.preventDefault();
        moveToPrevToken();
        return;
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        clearSelectedTokenAnnotation();
        return;
      }

      // Digit keys 1–9 pick the Nth visible sense for the selected token.
      if (selectedToken && /^[1-9]$/.test(e.key)) {
        const sense = filteredSenses[Number(e.key) - 1];
        if (sense) {
          e.preventDefault();
          handlePickSense(sense);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    toggleComplete,
    loadDocumentContent,
    currentDocIndex,
    advanceToNextToken,
    moveToPrevToken,
    clearSelectedTokenAnnotation,
    selectedToken,
    filteredSenses,
    handlePickSense,
    registerOpen,
  ]);

  // Keep the keyboard-selected token in view as selection moves.
  useEffect(() => {
    if (!selectedToken) return;
    document
      .querySelector(`[data-token-id="${selectedToken.id}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedToken]);

  // Progress over the loaded text: highlighted words (plus any word you tagged) vs. ones you resolved.
  const stats = useMemo(() => {
    const tokens = documentContent?.tokens ?? [];
    let ambiguousCount = 0;
    let resolved = 0;
    for (const token of tokens) {
      const mine = getMyAnnotation(token.id);
      if (mine) resolved++;
      if (mine || isAmbiguous(token.form)) ambiguousCount++;
    }
    return { total: tokens.length, ambiguous: ambiguousCount, resolved, remaining: ambiguousCount - resolved };
  }, [documentContent, getMyAnnotation, isAmbiguous]);

  // Left-pane log of this annotator's resolved words, oldest first so new ones append at the bottom.
  const completedEntries = useMemo<CompletedEntry[]>(() => {
    const tokens = documentContent?.tokens ?? [];
    const loadedIds = new Set(tokens.map(t => t.id));
    const sentences = new Map<number, string[]>();
    for (const t of tokens) {
      const forms = sentences.get(t.sentenceIndex) ?? [];
      forms.push(t.form);
      sentences.set(t.sentenceIndex, forms);
    }
    return Object.values(annotationsByToken)
      .flat()
      .filter(a => !!currentUser && a.annotatorId === currentUser)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .map(annotation => {
        const text =
          annotation.sentenceIndex != null ? sentences.get(annotation.sentenceIndex)?.join(' ') : undefined;
        return {
          annotation,
          snippet: text ? (text.length > 56 ? `${text.slice(0, 56)}…` : text) : null,
          navigable: loadedIds.has(annotation.tokenId),
        };
      });
  }, [annotationsByToken, documentContent, currentUser]);

  const selectCompleted = useCallback(
    (tokenId: string) => {
      const token = documentContent?.tokens.find(t => t.id === tokenId);
      if (token) selectToken(token);
    },
    [documentContent, selectToken],
  );

  if (loading) {
    return <FullScreenLoader label="Loading WSD Editor..." />;
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-indigo-50/30 to-purple-50/30 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
        <div className="text-center max-w-md p-8">
          <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold mb-4 text-slate-900 dark:text-white">Cannot Load Editor</h1>
          <p className="text-slate-600 dark:text-slate-400 mb-6">{error}</p>
          <div className="bg-slate-100 dark:bg-slate-800 rounded-lg p-4 text-left mb-6">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">To fix this:</p>
            <ol className="text-sm text-slate-600 dark:text-slate-400 space-y-1 list-decimal list-inside">
              <li>Start the API: <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">pnpm dev:api</code></li>
              <li>Ensure a document is uploaded to the workspace</li>
              <li>Wait for document tokenization to complete</li>
            </ol>
          </div>
          <div className="flex gap-3 justify-center">
            <Button variant="outline" onClick={() => window.location.reload()}>Try Again</Button>
            <Button onClick={() => router.push(`/workspace/${workspaceId}`)}>Back to Workspace</Button>
          </div>
        </div>
      </div>
    );
  }

  if (!editorData || editorData.documents.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">No documents in this workspace</h1>
          <Button onClick={() => router.push(`/workspace/${workspaceId}`)}>Back to Workspace</Button>
        </div>
      </div>
    );
  }

  const currentDoc = editorData.documents[currentDocIndex];
  const isComplete = currentDoc?.status === 'COMPLETE';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/30 to-purple-50/30 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      {/* Header */}
      <header className="border-b border-slate-200/60 dark:border-slate-800/60 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl sticky top-0 z-50 shadow-sm">
        <div className="max-w-full mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Image
              src="/genesis-logo.svg"
              alt="Genesis Logo"
              width={120}
              height={55}
              priority
              className="h-10 w-auto cursor-pointer"
              onClick={() => router.push('/home')}
            />
            <Separator orientation="vertical" className="h-10" />
            <div>
              <h1 className="text-lg font-bold text-slate-900 dark:text-white">{editorData.workspaceName}</h1>
              <p className="text-sm text-slate-600 dark:text-slate-400">Word Sense Disambiguation Editor</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Badge variant="secondary" className="text-sm">
              {stats.resolved}/{stats.ambiguous} ambiguous words resolved{currentUser ? ' by you' : ''}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await saveSession();
                router.push(`/workspace/${workspaceId}`);
              }}
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to Workspace
            </Button>
            <Button
              variant={isComplete ? 'default' : 'outline'}
              size="sm"
              className={isComplete ? 'bg-green-600 hover:bg-green-700 text-white' : ''}
              title="Mark complete & advance (⌘/Ctrl+Enter)"
              onClick={toggleComplete}
            >
              {isComplete ? (
                <>
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Completed
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Mark Complete
                </>
              )}
            </Button>
            <Avatar className="cursor-pointer ring-2 ring-white dark:ring-slate-800">
              <AvatarFallback className="bg-gradient-to-br from-[var(--primary)] to-purple-600 text-white font-bold">
                {user?.firstName?.charAt(0) || user?.username?.charAt(0) || 'U'}
              </AvatarFallback>
            </Avatar>
          </div>
        </div>
      </header>

      <div className="flex h-[calc(100vh-73px)]">
        {/* Left Pane - Sense Inventory */}
        <aside className="w-80 border-r border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm overflow-hidden">
          <Tabs value={leftTab} onValueChange={setLeftTab} className="h-full gap-0">
            <div className="p-3 border-b border-slate-200 dark:border-slate-800">
              <TabsList className="w-full">
                <TabsTrigger value="completed">Completed ({stats.resolved})</TabsTrigger>
                <TabsTrigger value="dictionary">Dictionary</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="completed" className="flex-1 overflow-y-auto p-3">
              <WsdCompletedLog
                entries={completedEntries}
                selectedTokenId={selectedToken?.id ?? null}
                onSelect={selectCompleted}
              />
            </TabsContent>
            <TabsContent value="dictionary" className="flex-1 min-h-0">
              <WsdSenseInventory workspaceId={workspaceId} onSensesChanged={handleDictionaryChanged} />
            </TabsContent>
          </Tabs>
        </aside>

        {/* Middle - Text Editor */}
        <main className="flex-1 overflow-y-auto" ref={containerRef} onScroll={handleScroll}>
          <div className="p-8">
            <DocumentSwitcher
              documents={editorData.documents}
              currentDocIndex={currentDocIndex}
              onSelect={loadDocumentContent}
            />

            <Card className="shadow-lg min-h-[600px]">
              <CardContent className="p-8">
                <div className="leading-relaxed text-slate-900 dark:text-white select-none">
                  {documentContent?.tokens?.map(token => {
                    const mine = getMyAnnotation(token.id);
                    const isSelected = selectedToken?.id === token.id;
                    const ambiguousToken = isAmbiguous(token.form);
                    const others = getOtherAnnotations(token.id).filter(a => a.senseId !== mine?.senseId);
                    const disagreementTitle = others.length > 0
                      ? others.map(a => `${a.annotatorId}: ${a.senseLabel ?? a.senseId}`).join('\n')
                      : undefined;
                    return (
                      <span
                        key={token.id}
                        data-token-id={token.id}
                        onClick={() => handleTokenClick(token)}
                        className={`inline-flex flex-col items-center mx-0.5 mb-1 px-1.5 py-1 cursor-pointer rounded-lg transition-all ${
                          isSelected
                            ? 'ring-2 ring-[var(--primary)] ring-offset-1 bg-indigo-50 dark:bg-indigo-950/40 shadow-md'
                            : mine
                              ? 'bg-green-100 dark:bg-green-900/40 hover:shadow-md'
                              : ambiguousToken
                                ? 'bg-amber-100 dark:bg-amber-900/30 border-b-2 border-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/50'
                                : 'hover:bg-slate-100 dark:hover:bg-slate-800/50'
                        }`}
                        title={
                          mine
                            ? `sense: ${mine.senseLabel ?? mine.senseId}`
                            : ambiguousToken
                              ? 'ambiguous word: click to choose its sense'
                              : 'click to register as an ambiguous word'
                        }
                      >
                        <span className="text-lg leading-tight">{token.form}</span>
                        {mine ? (
                          <span className="text-[10px] font-bold mt-0.5 leading-none text-green-700 dark:text-green-400 max-w-[120px] truncate">
                            {mine.senseLabel ?? '✓'}
                          </span>
                        ) : (
                          <span className="text-[10px] mt-0.5 leading-none invisible" aria-hidden>
                            &middot;
                          </span>
                        )}
                        <DisagreementDots
                          dots={others.map(a => ({ id: a.id }))}
                          title={disagreementTitle}
                        />
                      </span>
                    );
                  })}
                  {(!documentContent || !documentContent.tokens?.length) && (
                    <p className="text-slate-500">
                      {currentDoc?.isTokenized
                        ? 'Document has no tokens.'
                        : 'Document not yet tokenized.'}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            <EditorLoadMore {...pagination} />
          </div>
        </main>

        {/* Right pane — help, sense picker, stats */}
        <aside className="w-96 border-l border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
          <EditorHelpPanel
            accent="indigo"
            steps={[
              { badge: '1', body: <><strong>Click a highlighted word</strong> to see its senses</> },
              { badge: '2', body: <>Press <strong>✓</strong> on the sense that fits (or 1–9); <strong>✗</strong> dims one that doesn&apos;t</> },
              { badge: '3', body: <>No sense fits, or the word isn&apos;t highlighted? <strong>Add New</strong> / <strong>Register</strong> it</> },
            ]}
            shortcuts={[
              { keys: ['1', '–', '9'], label: 'Confirm Nth sense (✓)' },
              { keys: ['→', 'Tab'], label: 'Next highlighted word' },
              { keys: ['←'], label: 'Previous highlighted word' },
              { keys: ['Del'], label: 'Remove your tag' },
              { keys: ['[', ']'], label: 'Previous / next document' },
              { keys: ['⌘/Ctrl', '↵'], label: 'Mark complete & advance' },
              { keys: ['Esc'], label: 'Deselect' },
            ]}
          />

          <div className="p-4 border-b border-slate-200 dark:border-slate-800 sticky top-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm z-10">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              {selectedToken ? `Senses for "${selectedToken.form}"` : 'Senses'}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              {selectedToken ? 'Pick a sense to tag this token.' : 'Click a token to start.'}
            </p>
            {selectedToken && (
              <Input
                placeholder="Search senses…"
                value={senseFilter}
                onChange={e => setSenseFilter(e.target.value)}
                className="mt-3"
              />
            )}
          </div>

          <div className="p-3 space-y-2">
            {!selectedToken && (
              <p className="text-sm text-slate-500 px-2 py-4">
                Select a word in the document to view its senses.
              </p>
            )}

            {selectedToken && sensesLoading && (
              <p className="text-sm text-slate-500 px-2 py-4">Loading senses…</p>
            )}

            {selectedToken && !sensesLoading && senses.length === 0 && (
              <div className="px-2 py-4 text-sm text-slate-500 space-y-3">
                <p className="font-medium text-slate-700 dark:text-slate-300">
                  &ldquo;{selectedToken.form}&rdquo; is not in the ambiguous-word list.
                </p>
                {isWordLike(selectedToken.form) ? (
                  <>
                    <p>If it is ambiguous here, register it with its sense, gloss and an example.</p>
                    <Button size="sm" className="w-full" onClick={() => setRegisterOpen(true)}>
                      Register as ambiguous word
                    </Button>
                  </>
                ) : (
                  <p>Punctuation can&apos;t be registered.</p>
                )}
              </div>
            )}

            {selectedToken && !sensesLoading && filteredSenses.map((sense, idx) => {
              const mine = getMyAnnotation(selectedToken.id);
              const isMine = mine?.senseId === sense.id;
              const isRejected = (rejected[selectedToken.id] ?? []).includes(sense.id);
              return (
                <div
                  key={sense.id}
                  className={`rounded-lg border px-3 py-2 transition ${
                    isMine
                      ? 'border-green-500 bg-green-50 dark:bg-green-900/30'
                      : isRejected
                        ? 'border-slate-200 dark:border-slate-700 opacity-50'
                        : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {idx < 9 && (
                          <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 font-mono flex-shrink-0">
                            {idx + 1}
                          </kbd>
                        )}
                        <span className={`font-semibold text-sm text-slate-900 dark:text-white ${isRejected ? 'line-through' : ''}`}>
                          {sense.senseLabel}
                        </span>
                      </div>
                      {sense.gloss && (
                        <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">{sense.gloss}</div>
                      )}
                      {sense.examples && (
                        <div className="text-xs italic text-slate-500 mt-1">&ldquo;{sense.examples}&rdquo;</div>
                      )}
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <Button
                        size="icon"
                        variant={isMine ? 'default' : 'outline'}
                        className={`h-8 w-8 ${isMine ? 'bg-green-600 hover:bg-green-700 text-white' : 'text-green-700 hover:text-green-800'}`}
                        aria-label={`Confirm sense ${sense.senseLabel}`}
                        title="This sense fits (✓)"
                        onClick={() => handlePickSense(sense)}
                      >
                        <Check className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="outline"
                        className={`h-8 w-8 ${isRejected ? 'bg-red-50 text-red-700' : 'text-red-600 hover:text-red-700'}`}
                        aria-label={`Reject sense ${sense.senseLabel}`}
                        title="This sense doesn't fit (✗, saved). Click again to undo"
                        onClick={() => handleRejectSense(sense)}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}

            {selectedToken && !sensesLoading && senses.length > 0 && filteredSenses.length === 0 && (
              <p className="text-sm text-slate-500 px-2 py-4">No senses match the filter.</p>
            )}

            {selectedToken && !sensesLoading && senses.length > 0 && (
              <details key={selectedToken.id} className="rounded-lg border border-dashed border-slate-300 dark:border-slate-600">
                <summary className="cursor-pointer select-none px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                  + Add New
                </summary>
                <div className="p-3 pt-1">
                  <p className="text-xs text-slate-500 mb-2">None of the senses above fit? Add one for &ldquo;{selectedToken.form}&rdquo;.</p>
                  <WsdAddSenseForm
                    word={selectedToken.form}
                    submitLabel="Add & select sense"
                    onSubmit={createSenseForSelected}
                  />
                </div>
              </details>
            )}
          </div>

          <Separator />

          <div className="p-4">
            <h3 className="font-bold text-slate-900 dark:text-white mb-4">Statistics</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">Documents</span>
                <span className="font-bold">{editorData.totalDocuments}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">Ambiguous words</span>
                <span className="font-bold">{stats.ambiguous}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">Resolved</span>
                <span className="font-bold text-green-600">{stats.resolved}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">Remaining</span>
                <span className="font-bold text-orange-500">{stats.remaining}</span>
              </div>
            </div>

            {stats.ambiguous > 0 && (
              <div className="mt-4">
                <div className="flex justify-between text-xs text-slate-500 mb-1">
                  <span>Progress</span>
                  <span>{Math.round((stats.resolved / stats.ambiguous) * 100)}%</span>
                </div>
                <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[var(--primary)] to-purple-500 rounded-full transition-all duration-500"
                    style={{ width: `${(stats.resolved / stats.ambiguous) * 100}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      <WsdRegisterWordDialog
        open={registerOpen && !!selectedToken}
        onOpenChange={setRegisterOpen}
        word={selectedToken?.form ?? ''}
        onSubmit={createSenseForSelected}
      />
    </div>
  );
}
