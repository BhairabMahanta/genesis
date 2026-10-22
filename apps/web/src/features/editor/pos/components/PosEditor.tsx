'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/features/auth/auth.provider';
import type {
  WorkspaceEditorResponse,
  DocumentContentResponse,
  TokenDto,
} from '@/features/editor/core/editor.contracts';
import {
  UNIVERSAL_POS_TAGS,
  type PosTag,
  type PosTagScope,
  type PosAnnotation,
} from '@/features/editor/pos/pos.contracts';
import {
  getDocumentContentAction,
  getEditorDocumentsAction,
  getEditorSessionAction,
  saveEditorSessionAction,
} from '@/features/editor/core/editor.actions';
import {
  createPosTagAction,
  listPosAnnotationsAction,
  listPosTagsAction,
  updateTokenPosAction,
} from '@/features/editor/pos/pos.actions';
import { updateDocumentStatusAction } from '@/features/document/document.actions';
import { useEditorSession } from '@/features/editor/core/hooks/useEditorSession';
import { usePaginatedDocument, EDITOR_PAGE_SIZE } from '@/features/editor/core/hooks/usePaginatedDocument';
import { EditorLoadMore } from '@/features/editor/core/components/EditorLoadMore';
import { DocumentSwitcher } from '@/features/editor/core/components/DocumentSwitcher';
import { EditorHelpPanel } from '@/features/editor/core/components/EditorHelpPanel';
import { DisagreementDots } from '@/features/editor/core/components/DisagreementDots';
import { FullScreenLoader } from '@/components/Spinner';
import { buildEditorData, groupAnnotationsByToken, mergeTagDefinitions } from '@/features/editor/core/editor.utils';
import { toast } from 'sonner';

interface PosEditorProps {
  workspaceId: string;
  workspaceName: string;
}

export default function PosEditor({ workspaceId, workspaceName }: PosEditorProps) {
  const router = useRouter();
  const { user } = useAuth();

  // API Data State
  const [editorData, setEditorData] = useState<WorkspaceEditorResponse | null>(null);
  const [documentContent, setDocumentContent] = useState<DocumentContentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // UI State
  const [currentDocIndex, setCurrentDocIndex] = useState(0);
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [selectedPosTag, setSelectedPosTag] = useState<PosTag | null>(null);

  // Track local POS overrides (optimistic updates before API confirms)
  const [localPosMap, setLocalPosMap] = useState<Record<string, string | null>>({});

  // All annotators' POS tags for the current document, keyed by tokenId.
  const [annotationsByToken, setAnnotationsByToken] = useState<Record<string, PosAnnotation[]>>({});

  // Effective tag set for this workspace (universal + global customs + workspace customs).
  const [availableTags, setAvailableTags] = useState<PosTag[]>(() =>
    UNIVERSAL_POS_TAGS.map(t => ({ ...t, builtin: true })));

  // Add-tag dialog state
  const [showAddTagDialog, setShowAddTagDialog] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagDescription, setNewTagDescription] = useState('');
  const [newTagScope, setNewTagScope] = useState<PosTagScope>('WORKSPACE');
  const [addTagError, setAddTagError] = useState<string | null>(null);
  const [addingTag, setAddingTag] = useState(false);

  const refreshTags = useCallback(async () => {
    const result = await listPosTagsAction(workspaceId);
    if (result.ok) {
      setAvailableTags(mergeTagDefinitions(UNIVERSAL_POS_TAGS, result.data || []));
    }
    // On failure, fall back to universal tags — already initialised in state.
  }, [workspaceId]);

  useEffect(() => {
    if (workspaceId) refreshTags();
  }, [workspaceId, refreshTags]);

  const currentUser = user?.id ?? null;

  const { saveSession, containerRef, lastScrollRef, handleScroll } = useEditorSession({
    workspaceId,
    currentDocIndex,
    editorData,
    loading,
  });

  // Load workspace data on mount
  useEffect(() => {
    const loadWorkspace = async () => {
      setLoading(true);
      setError(null);

      const docsResult = await getEditorDocumentsAction(workspaceId);
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

      setEditorData(buildEditorData(workspaceId, workspaceName, 'POS', documents, savedSession));

      if (documents.length > 0) {
        const doc = documents[initialDocIndex];
        setCurrentDocIndex(initialDocIndex);

        if (doc.isTokenized && doc.tokenCount > 0) {
          const contentResult = await getDocumentContentAction(workspaceId, doc.id, 0, EDITOR_PAGE_SIZE);
          if (contentResult.ok) {
            setDocumentContent(contentResult.data);

            const annResult = await listPosAnnotationsAction(doc.id);
            setAnnotationsByToken(
              annResult.ok ? groupAnnotationsByToken(annResult.data || []) : {},
            );

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

      setLoading(false);
    };

    if (workspaceId) {
      loadWorkspace();
    }
  }, [workspaceId, workspaceName, containerRef, lastScrollRef]);

  // Load document content when switching documents
  const loadDocumentContent = useCallback(async (docIndex: number) => {
    if (!editorData || docIndex < 0 || docIndex >= editorData.documents.length) return;

    const scrollPos = containerRef.current?.scrollTop || 0;
    // Session save is best-effort; ignore its result.
    await saveEditorSessionAction({
      workspaceId,
      lastDocumentIndex: docIndex,
      scrollPosition: scrollPos,
    });

    setSelectedTokenId(null);
    setLocalPosMap({});
    setAnnotationsByToken({});

    const docId = editorData.documents[docIndex].id;
    const contentResult = await getDocumentContentAction(workspaceId, docId, 0, EDITOR_PAGE_SIZE);
    if (!contentResult.ok) {
      toast.error(contentResult.error || 'Failed to load document');
      return;
    }
    setDocumentContent(contentResult.data);
    setCurrentDocIndex(docIndex);

    const annResult = await listPosAnnotationsAction(docId);
    setAnnotationsByToken(
      annResult.ok ? groupAnnotationsByToken(annResult.data || []) : {},
    );
  }, [editorData, workspaceId, containerRef]);

  const pagination = usePaginatedDocument({
    workspaceId,
    documentContent,
    setDocumentContent,
    scrollRootRef: containerRef,
  });

  // Handle token click - select it for tagging
  const handleTokenClick = (token: TokenDto, e: React.MouseEvent) => {
    e.stopPropagation();

    if (selectedTokenId === token.id) {
      // Clicking same token deselects
      setSelectedTokenId(null);
      return;
    }

    setSelectedTokenId(token.id);

    // If a POS tag is already selected in the palette, apply it immediately
    if (selectedPosTag) {
      applyPosTag(token.id, selectedPosTag.tag);
    }
  };

  // Apply POS tag to a token
  const applyPosTag = useCallback(async (tokenId: string, posTag: string | null) => {
    // Optimistic update
    setLocalPosMap(prev => ({ ...prev, [tokenId]: posTag }));

    const result = await updateTokenPosAction(tokenId, posTag);
    if (!result.ok) {
      toast.error(result.error || 'Failed to update POS tag');
      // Revert on error
      setLocalPosMap(prev => {
        const next = { ...prev };
        delete next[tokenId];
        return next;
      });
      return;
    }
    // Refresh annotations cache: insert/replace current-user entry, or remove on null.
    setAnnotationsByToken(prev => {
      const next = { ...prev };
      const existing = next[tokenId] ? [...next[tokenId]] : [];
      const filtered = currentUser
        ? existing.filter(a => a.annotatorId !== currentUser)
        : existing;
      if (posTag !== null && result.data) {
        filtered.push(result.data);
      }
      if (filtered.length === 0) {
        delete next[tokenId];
      } else {
        next[tokenId] = filtered;
      }
      return next;
    });
  }, [currentUser]);

  // Handle POS tag selection from palette
  const handlePosTagSelect = (tag: PosTag) => {
    if (selectedPosTag?.tag === tag.tag) {
      // Deselect
      setSelectedPosTag(null);
      return;
    }

    setSelectedPosTag(tag);

    // If a token is selected, apply immediately
    if (selectedTokenId) {
      applyPosTag(selectedTokenId, tag.tag);
      // Advance to next token
      advanceToNextToken();
    }
  };

  // Advance selection to the next token. With nothing selected, this anchors on
  // the first token — the keyboard-only entry point into the document.
  const advanceToNextToken = useCallback(() => {
    const tokens = documentContent?.tokens;
    if (!tokens || tokens.length === 0) return;

    if (!selectedTokenId) {
      setSelectedTokenId(tokens[0].id);
      return;
    }
    const currentIdx = tokens.findIndex(t => t.id === selectedTokenId);
    if (currentIdx >= 0 && currentIdx < tokens.length - 1) {
      setSelectedTokenId(tokens[currentIdx + 1].id);
    } else {
      setSelectedTokenId(null);
    }
  }, [selectedTokenId, documentContent]);

  // Move to previous token. With nothing selected, anchors on the last token.
  const moveToPrevToken = useCallback(() => {
    const tokens = documentContent?.tokens;
    if (!tokens || tokens.length === 0) return;

    if (!selectedTokenId) {
      setSelectedTokenId(tokens[tokens.length - 1].id);
      return;
    }
    const currentIdx = tokens.findIndex(t => t.id === selectedTokenId);
    if (currentIdx > 0) {
      setSelectedTokenId(tokens[currentIdx - 1].id);
    }
  }, [selectedTokenId, documentContent]);

  // Get effective POS for a token: local optimistic write > current user's
  // annotation > most-recent annotation > legacy token.pos column.
  const getTokenPos = useCallback((token: TokenDto): string | null => {
    if (token.id in localPosMap) return localPosMap[token.id];
    const annotations = annotationsByToken[token.id];
    if (annotations && annotations.length > 0) {
      if (currentUser) {
        const mine = annotations.find(a => a.annotatorId === currentUser);
        if (mine) return mine.posTag;
      }
      const sorted = [...annotations].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      return sorted[0].posTag;
    }
    return token.pos;
  }, [localPosMap, annotationsByToken, currentUser]);

  // Annotations from OTHER annotators (not current user) for disagreement display.
  const getOtherAnnotations = (tokenId: string): PosAnnotation[] => {
    const all = annotationsByToken[tokenId] || [];
    if (!currentUser) return [];
    return all.filter(a => a.annotatorId !== currentUser);
  };

  // Get PosTag object for a given tag string
  const getPosTagInfo = (tag: string | null): PosTag | undefined => {
    if (!tag) return undefined;
    return availableTags.find(t => t.tag === tag);
  };

  // Remove POS tag from selected token
  const clearSelectedTokenPos = useCallback(() => {
    if (selectedTokenId) {
      applyPosTag(selectedTokenId, null);
    }
  }, [selectedTokenId, applyPosTag]);

  // Toggle the current document's complete status, auto-advancing to the next
  // document when marking complete (⌘/Ctrl+Enter, or the header button). Mirrors
  // COREF/NER.
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
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // Mark complete & advance — ⌘/Ctrl+Enter (checked before the bare-Enter
      // palette-apply branch below).
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        toggleComplete();
        return;
      }

      // Every shortcut below is a bare key — bail if a modifier is held so we
      // don't hijack browser shortcuts that collide with single-letter tag keys
      // (e.g. ⌘R/⌘P/⌘D would otherwise apply ADV/PROPN/DET and block reload).
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'Escape') {
        setSelectedTokenId(null);
        setSelectedPosTag(null);
        return;
      }

      // Previous / next document
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

      if (e.key === 'ArrowRight' || e.key === 'Tab') {
        e.preventDefault();
        advanceToNextToken();
        return;
      }

      if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) {
        e.preventDefault();
        moveToPrevToken();
        return;
      }

      // Move selection within the POS tag palette (wraps).
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const idx = selectedPosTag
          ? availableTags.findIndex(t => t.tag === selectedPosTag.tag)
          : -1;
        const len = availableTags.length;
        if (len === 0) return;
        const next = e.key === 'ArrowDown'
          ? (idx + 1 + len) % len
          : (idx <= 0 ? len - 1 : idx - 1);
        setSelectedPosTag(availableTags[next]);
        return;
      }

      // Enter applies the highlighted palette tag to the selected token and advances.
      if (e.key === 'Enter') {
        if (selectedPosTag && selectedTokenId) {
          e.preventDefault();
          applyPosTag(selectedTokenId, selectedPosTag.tag);
          advanceToNextToken();
        }
        return;
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        clearSelectedTokenPos();
        return;
      }

      // POS tag shortcuts
      const tag = availableTags.find(t => t.shortcut === e.key.toLowerCase());
      if (tag) {
        e.preventDefault();
        if (selectedTokenId) {
          applyPosTag(selectedTokenId, tag.tag);
          advanceToNextToken();
        } else {
          // Just select the tag in palette
          setSelectedPosTag(prev => prev?.tag === tag.tag ? null : tag);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [advanceToNextToken, moveToPrevToken, clearSelectedTokenPos, selectedTokenId, selectedPosTag, applyPosTag, availableTags, toggleComplete, loadDocumentContent, currentDocIndex]);

  // Keep the keyboard-selected token in view as the selection moves through the
  // document (so arrow/Tab navigation doesn't run off-screen).
  useEffect(() => {
    if (!selectedTokenId) return;
    document
      .querySelector(`[data-token-id="${selectedTokenId}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedTokenId]);

  const openAddTagDialog = () => {
    setNewTagName('');
    setNewTagDescription('');
    setNewTagScope('WORKSPACE');
    setAddTagError(null);
    setShowAddTagDialog(true);
  };

  const handleCreateTag = async () => {
    setAddTagError(null);
    const tag = newTagName.trim().toUpperCase();
    if (!tag) {
      setAddTagError('Tag is required');
      return;
    }
    if (!/^[A-Z][A-Z0-9_]{0,19}$/.test(tag)) {
      setAddTagError('Tag must start with a letter and contain only A-Z, 0-9, underscore (max 20 chars)');
      return;
    }
    setAddingTag(true);
    const result = await createPosTagAction({
      tag,
      description: newTagDescription.trim() || null,
      scope: newTagScope,
      workspaceId: newTagScope === 'WORKSPACE' ? workspaceId : null,
    });
    setAddingTag(false);
    if (!result.ok) {
      setAddTagError(result.error);
      return;
    }
    setShowAddTagDialog(false);
    await refreshTags();
  };

  // Single pass over the document for both the header stats and the tag-
  // distribution panel, memoized so it doesn't re-run on every keystroke
  // (selection changes re-render but don't touch tags). Recomputes only when
  // the document or any effective POS value changes (via getTokenPos's deps).
  const { stats, tagCounts } = useMemo(() => {
    const tokens = documentContent?.tokens ?? [];
    const counts: Record<string, number> = {};
    let tagged = 0;
    for (const token of tokens) {
      const pos = getTokenPos(token);
      if (pos) {
        tagged++;
        counts[pos] = (counts[pos] || 0) + 1;
      }
    }
    return {
      stats: { total: tokens.length, tagged, untagged: tokens.length - tagged },
      tagCounts: counts,
    };
  }, [documentContent, getTokenPos]);

  // Render tokens with POS annotations
  const renderTokenizedText = () => {
    if (!documentContent?.tokens?.length) {
      return <p className="text-slate-500">No tokens available. Document may not be tokenized yet.</p>;
    }

    const sentences = documentContent.sentences || [];

    return sentences.map((_, sentIdx) => {
      const sentenceTokens = documentContent.tokens.filter(t => t.sentenceIndex === sentIdx);

      return (
        <div key={`sentence-${sentIdx}`} className="mb-4">
          {sentenceTokens.map((token) => {
            const pos = getTokenPos(token);
            const tagInfo = getPosTagInfo(pos);
            const isSelected = selectedTokenId === token.id;
            const others = getOtherAnnotations(token.id).filter(a => a.posTag !== pos);
            const disagreementTitle = others.length > 0
              ? others.map(a => `${a.annotatorId}: ${a.posTag}`).join('\n')
              : undefined;

            return (
              <span
                key={token.id}
                data-token-id={token.id}
                className={`inline-flex flex-col items-center mx-0.5 mb-1 cursor-pointer rounded-lg px-1.5 py-1 transition-all ${
                  isSelected
                    ? 'ring-2 ring-[var(--primary)] ring-offset-1 bg-indigo-50 dark:bg-indigo-950/40 shadow-md'
                    : pos
                      ? 'hover:shadow-md hover:scale-105'
                      : 'hover:bg-slate-100 dark:hover:bg-slate-800/50'
                }`}
                style={pos && tagInfo ? {
                  backgroundColor: `${tagInfo.color}15`,
                  borderBottom: `3px solid ${tagInfo.color}`,
                } : undefined}
                onClick={(e) => handleTokenClick(token, e)}
                title={tagInfo ? `${tagInfo.label}: ${tagInfo.description}` : 'Click to tag'}
              >
                <span className="text-lg text-slate-900 dark:text-white leading-tight">
                  {token.form}
                </span>
                {pos && tagInfo ? (
                  <span
                    className="text-[10px] font-bold mt-0.5 leading-none"
                    style={{ color: tagInfo.color }}
                  >
                    {pos}
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-300 dark:text-slate-600 mt-0.5 leading-none">
                    &mdash;
                  </span>
                )}
                <DisagreementDots
                  dots={others.map(a => ({ id: a.id, color: getPosTagInfo(a.posTag)?.color || '#9ca3af' }))}
                  title={disagreementTitle}
                />
              </span>
            );
          })}
        </div>
      );
    });
  };

  // Loading state
  if (loading) {
    return <FullScreenLoader label="Loading POS Editor..." />;
  }

  // Error state
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
              <li>Start the backend: <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">genesis.bat run</code></li>
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

  if (!editorData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">No workspace data</h1>
          <Button onClick={() => router.push('/home')}>Back to Home</Button>
        </div>
      </div>
    );
  }

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
              <p className="text-sm text-slate-600 dark:text-slate-400">Part-of-Speech Tagging Editor</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {selectedPosTag && (
              <Badge variant="default" className="text-white animate-pulse" style={{ backgroundColor: selectedPosTag.color }}>
                Tagging: {selectedPosTag.label} ({selectedPosTag.tag})
              </Badge>
            )}
            <Badge variant="secondary" className="text-sm">
              {stats.tagged}/{stats.total} tagged{currentUser ? ' by you' : ''}
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
              variant={editorData.documents[currentDocIndex]?.status === 'COMPLETE' ? 'default' : 'outline'}
              size="sm"
              className={editorData.documents[currentDocIndex]?.status === 'COMPLETE' ? 'bg-green-600 hover:bg-green-700 text-white' : ''}
              title="Mark complete & advance (⌘/Ctrl+Enter)"
              onClick={toggleComplete}
            >
              {editorData.documents[currentDocIndex]?.status === 'COMPLETE' ? (
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
        {/* Left Pane - POS Tag Palette */}
        <aside className="w-72 border-r border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 sticky top-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm z-10">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">POS Tags</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              Select a tag, then click tokens
            </p>
          </div>

          <div className="p-3 space-y-1">
            {availableTags.map((tag) => {
              const isActive = selectedPosTag?.tag === tag.tag;
              return (
                <button
                  key={tag.tag}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all ${
                    isActive
                      ? 'ring-2 ring-offset-1 shadow-md'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                  style={isActive ? {
                    backgroundColor: `${tag.color}15`,
                    outlineColor: tag.color,
                    outline: `2px solid ${tag.color}`,
                    outlineOffset: '1px',
                  } : undefined}
                  onClick={() => handlePosTagSelect(tag)}
                >
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: tag.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-sm text-slate-900 dark:text-white">{tag.tag}</span>
                      <span className="text-xs text-slate-500 truncate">{tag.label}</span>
                    </div>
                  </div>
                  {tag.shortcut && (
                    <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 font-mono flex-shrink-0">
                      {tag.shortcut}
                    </kbd>
                  )}
                </button>
              );
            })}

            <Separator className="my-2" />

            <button
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
              onClick={() => {
                setSelectedPosTag(null);
                if (selectedTokenId) clearSelectedTokenPos();
              }}
            >
              <svg className="w-3 h-3 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              <span className="text-sm text-red-600 dark:text-red-400 font-medium">Clear Tag</span>
              <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 font-mono ml-auto flex-shrink-0">
                Del
              </kbd>
            </button>

            <button
              className="w-full flex items-center gap-2.5 px-3 py-2 mt-1 rounded-lg text-left hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-all"
              onClick={openAddTagDialog}
            >
              <svg className="w-3 h-3 text-indigo-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="text-sm text-indigo-700 dark:text-indigo-400 font-medium">Add custom tag</span>
            </button>
          </div>
        </aside>

        {/* Middle - Text Editor */}
        <main
          className="flex-1 overflow-y-auto"
          ref={containerRef}
          onScroll={handleScroll}
          onClick={() => { setSelectedTokenId(null); }}
        >
          <div className="p-8">
            {/* Document switcher: scrollable strip + prev/next + progress */}
            <DocumentSwitcher
              documents={editorData.documents}
              currentDocIndex={currentDocIndex}
              onSelect={loadDocumentContent}
            />

            <Card className="shadow-lg min-h-[600px]">
              <CardContent className="p-8" onClick={(e) => e.stopPropagation()}>
                <div className="leading-relaxed text-slate-900 dark:text-white select-none">
                  {renderTokenizedText()}
                </div>
              </CardContent>
            </Card>

            <EditorLoadMore {...pagination} />
          </div>
        </main>

        {/* Right Pane - Instructions & Statistics */}
        <aside className="w-72 border-l border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
          <EditorHelpPanel
            accent="blue"
            steps={[
              { badge: '1', body: <><strong>Select a POS tag</strong> from the left palette</> },
              { badge: '2', body: <><strong>Click tokens</strong> in the text to apply the tag</> },
              { badge: '3', body: <>Use <strong>keyboard shortcuts</strong> for quick tagging</> },
            ]}
            shortcuts={[
              { keys: ['Tab', '→'], label: 'Next token' },
              { keys: ['←'], label: 'Prev token' },
              { keys: ['Del'], label: 'Clear tag' },
              { keys: ['[', ']'], label: 'Previous / next document' },
              { keys: ['⌘/Ctrl', '↵'], label: 'Mark complete & advance' },
              { keys: ['Esc'], label: 'Cancel' },
            ]}
          />

          <div className="p-4">
          <h3 className="font-bold text-slate-900 dark:text-white mb-4">Statistics</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">Documents</span>
              <span className="font-bold">{editorData.totalDocuments}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">Total Tokens</span>
              <span className="font-bold">{stats.total}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">Tagged</span>
              <span className="font-bold text-green-600">{stats.tagged}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600 dark:text-slate-400">Untagged</span>
              <span className="font-bold text-orange-500">{stats.untagged}</span>
            </div>
          </div>

          {/* Progress bar */}
          {stats.total > 0 && (
            <div className="mt-4">
              <div className="flex justify-between text-xs text-slate-500 mb-1">
                <span>Progress</span>
                <span>{Math.round((stats.tagged / stats.total) * 100)}%</span>
              </div>
              <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[var(--primary)] to-purple-500 rounded-full transition-all duration-500"
                  style={{ width: `${(stats.tagged / stats.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          <Separator className="my-6" />

          {/* Tag distribution */}
          <h3 className="font-bold text-slate-900 dark:text-white mb-4">Tag Distribution</h3>
          <div className="space-y-1.5 text-sm">
            {(() => {
              const entries = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
              if (entries.length === 0) {
                return <p className="text-xs text-slate-400">No tags assigned yet</p>;
              }
              return entries.map(([tag, count]) => {
                const tagInfo = getPosTagInfo(tag);
                return (
                  <div key={tag} className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: tagInfo?.color || '#9ca3af' }}
                    />
                    <span className="font-mono text-xs text-slate-600 dark:text-slate-400 w-12">{tag}</span>
                    <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(count / stats.total) * 100}%`,
                          backgroundColor: tagInfo?.color || '#9ca3af',
                        }}
                      />
                    </div>
                    <span className="text-xs text-slate-500 w-6 text-right">{count}</span>
                  </div>
                );
              });
            })()}
          </div>
          </div>
        </aside>
      </div>

      <Dialog open={showAddTagDialog} onOpenChange={setShowAddTagDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add custom POS tag</DialogTitle>
            <DialogDescription>
              Define a tag beyond the 17 Universal Dependencies built-ins. Workspace-only
              tags are visible to this workspace; global tags are visible everywhere.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-tag-name">Tag</Label>
              <Input
                id="new-tag-name"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value.toUpperCase())}
                placeholder="e.g. NEG"
                maxLength={20}
                className="font-mono uppercase"
              />
              <p className="text-xs text-slate-500">
                Uppercase, starts with a letter, letters/digits/underscore only (max 20).
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-tag-description">Description (optional)</Label>
              <Textarea
                id="new-tag-description"
                value={newTagDescription}
                onChange={(e) => setNewTagDescription(e.target.value)}
                placeholder="What does this tag mean?"
                rows={2}
                maxLength={200}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Scope</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setNewTagScope('WORKSPACE')}
                  className={`flex-1 px-3 py-2 rounded-lg border text-sm transition ${
                    newTagScope === 'WORKSPACE'
                      ? 'border-[var(--primary)] bg-indigo-50 dark:bg-indigo-900/20 text-[var(--primary)]'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                  }`}
                >
                  <div className="font-medium">This workspace</div>
                  <div className="text-xs text-slate-500">Visible only here</div>
                </button>
                <button
                  type="button"
                  onClick={() => setNewTagScope('GLOBAL')}
                  className={`flex-1 px-3 py-2 rounded-lg border text-sm transition ${
                    newTagScope === 'GLOBAL'
                      ? 'border-[var(--primary)] bg-indigo-50 dark:bg-indigo-900/20 text-[var(--primary)]'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                  }`}
                >
                  <div className="font-medium">Global</div>
                  <div className="text-xs text-slate-500">Visible across workspaces</div>
                </button>
              </div>
            </div>

            {addTagError && (
              <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                {addTagError}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowAddTagDialog(false)}
              disabled={addingTag}
            >
              Cancel
            </Button>
            <Button onClick={handleCreateTag} disabled={addingTag}>
              {addingTag ? 'Adding…' : 'Add tag'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
