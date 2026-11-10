'use client';

import { FileText, MoreVertical, Play, Search, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DocumentResponse } from '@/features/document/document.contracts';
import { isOneOf } from '@/lib/utils';

export const DOCUMENT_FILTERS = ['all', 'completed', 'in-progress', 'unannotated'] as const;
export type DocumentFilter = (typeof DOCUMENT_FILTERS)[number];

interface DocumentGridProps {
  documents: DocumentResponse[];
  filter: DocumentFilter;
  onChangeFilter: (filter: DocumentFilter) => void;
  searchQuery: string;
  onChangeSearch: (q: string) => void;
  isUploading: boolean;
  uploadProgress?: { done: number; total: number; failed: number } | null;
  onUploadClick: () => void;
  onAnnotate: () => void;
  onExportDocument: (documentId: string) => void;
  onDeleteDocument: (documentId: string) => void;
}

function filterCategoryOf(status: string): DocumentFilter {
  const s = status.toLowerCase();
  if (s === 'complete') return 'completed';
  if (s === 'annotating') return 'in-progress';
  return 'unannotated';
}

function statusBadge(status: string) {
  switch (status) {
    case 'COMPLETE':
      return { label: 'Completed', color: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' };
    case 'ANNOTATING':
      return { label: 'In Progress', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' };
    default:
      return { label: 'Unannotated', color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' };
  }
}

function formatFileSize(bytes?: number) {
  if (!bytes) return 'Unknown logic';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function DocumentGrid({
  documents,
  filter,
  onChangeFilter,
  searchQuery,
  onChangeSearch,
  isUploading,
  uploadProgress,
  onUploadClick,
  onAnnotate,
  onExportDocument,
  onDeleteDocument,
}: DocumentGridProps) {
  const filtered = documents.filter((doc) => {
    const matchesFilter = filter === 'all' || filterCategoryOf(doc.status) === filter;
    const matchesSearch = doc.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 dark:text-white">Documents</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Select one or many `.txt` / CoNLL files at once.
          </p>
        </div>
        <Button className="gap-2" onClick={onUploadClick} disabled={isUploading}>
          <Upload className="w-5 h-5" />
          {isUploading
            ? uploadProgress
              ? `Uploading ${uploadProgress.done}/${uploadProgress.total}...`
              : 'Uploading...'
            : 'Upload Documents'}
        </Button>
      </div>

      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <Input
              type="search"
              placeholder="Search documents..."
              value={searchQuery}
              onChange={(e) => onChangeSearch(e.target.value)}
              className="pl-12 h-11"
            />
          </div>
        </div>
        <Tabs
          value={filter}
          onValueChange={(value) => { if (isOneOf(value, DOCUMENT_FILTERS)) onChangeFilter(value); }}
          className="w-auto"
        >
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
            <TabsTrigger value="in-progress">In Progress</TabsTrigger>
            <TabsTrigger value="unannotated">Unannotated</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <FileText className="w-5 h-5 mx-auto text-slate-400" />
              <p className="text-slate-600 dark:text-slate-400 mt-4">No documents found</p>
            </CardContent>
          </Card>
        ) : (
          filtered.map((doc) => {
            const status = statusBadge(doc.status);
            return (
              <Card key={doc.id} className="hover:shadow-md transition-shadow">
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-4 flex-1">
                    <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-900 dark:text-white truncate">
                        {doc.name}
                      </p>
                      <div className="flex items-center gap-4 text-sm text-slate-600 dark:text-slate-400 mt-1">
                        <span>{formatFileSize(doc.fileSize)}</span>
                        <span>•</span>
                        <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
                      </div>
                      {doc.progress !== undefined && doc.progress > 0 && (
                        <div className="mt-2 w-full max-w-xs">
                          <div className="flex justify-between text-[10px] mb-1 text-slate-500">
                            <span>Progress</span>
                            <span>{Math.round(doc.progress * 100)}%</span>
                          </div>
                          <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded-full transition-all duration-500"
                              style={{ width: `${Math.round((doc.progress || 0) * 100)}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge className={status.color}>{status.label}</Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAnnotate();
                      }}
                    >
                      <Play className="w-5 h-5" />
                      {doc.status === 'COMPLETE' ? 'View' : 'Annotate'}
                    </Button>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label="Document actions">
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onExportDocument(doc.id)}>
                          Export CoNLL
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => onDeleteDocument(doc.id)} className="text-red-600">
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
