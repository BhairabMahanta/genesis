'use client';

import { useState, useRef, type ChangeEvent, type FormEvent } from 'react';
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { importSensesAction } from '@/features/editor/wsd/wsd.actions';
import type { ImportSensesResult } from '@/features/editor/wsd/wsd.contracts';

interface WsdImportModalProps {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function WsdImportModal({
  workspaceId,
  open,
  onOpenChange,
  onSuccess,
}: WsdImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'skip' | 'overwrite'>('skip');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportSensesResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetState = () => {
    setFile(null);
    setError(null);
    setResult(null);
    setSubmitting(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetState();
    }
    onOpenChange(newOpen);
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      setError(null);
      setResult(null);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Please select a file to import.');
      return;
    }

    setSubmitting(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('mode', mode);

    const res = await importSensesAction(workspaceId, formData);
    setSubmitting(false);

    if (!res.ok) {
      setError(res.error);
      toast.error(res.error);
      return;
    }

    setResult(res.data);
    toast.success(`Successfully imported ${res.data.inserted.toLocaleString()} senses!`);
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px] p-6 gap-5">
        <DialogHeader className="gap-1.5">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
              <UploadCloud className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-slate-900 dark:text-white">
                Import Dictionary Senses
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
                Bulk ingest OCR text, CSV/JSON, or the original Excel ambiguous-word template.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {result ? (
          <div className="space-y-4 py-2">
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/20 p-4 space-y-3">
              <div className="flex items-center gap-2.5 text-emerald-800 dark:text-emerald-300 font-semibold text-sm">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>Import Finished</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                <div className="bg-white/80 dark:bg-slate-900/80 p-2.5 rounded-lg border border-emerald-100 dark:border-emerald-900/40">
                  <span className="text-slate-500 block text-[11px]">Total Processed</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200 text-sm">
                    {result.totalProcessed.toLocaleString()}
                  </span>
                </div>
                <div className="bg-white/80 dark:bg-slate-900/80 p-2.5 rounded-lg border border-emerald-100 dark:border-emerald-900/40">
                  <span className="text-emerald-600 dark:text-emerald-400 block text-[11px]">
                    Successfully Inserted
                  </span>
                  <span className="font-semibold text-emerald-700 dark:text-emerald-300 text-sm">
                    {result.inserted.toLocaleString()}
                  </span>
                </div>
                <div className="bg-white/80 dark:bg-slate-900/80 p-2.5 rounded-lg border border-emerald-100 dark:border-emerald-900/40">
                  <span className="text-slate-500 block text-[11px]">Duplicates Skipped</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-300 text-sm">
                    {result.skipped.toLocaleString()}
                  </span>
                </div>
                <div className="bg-white/80 dark:bg-slate-900/80 p-2.5 rounded-lg border border-emerald-100 dark:border-emerald-900/40">
                  <span className="text-slate-500 block text-[11px]">Updated / Overwritten</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-300 text-sm">
                    {result.updated.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                type="button"
                className="h-8 text-xs px-4"
                onClick={() => handleOpenChange(false)}
              >
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 p-2.5 text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Dropzone / File Selector */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-colors duration-150 ${
                file
                  ? 'border-indigo-400 bg-indigo-50/30 dark:border-indigo-700 dark:bg-indigo-950/20'
                  : 'border-slate-300 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-600 bg-slate-50/50 dark:bg-slate-900/50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".jsonl,.json,.csv,.tsv,.xls,.xlsx,.xlsm,application/json,text/csv,text/tab-separated-values,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={handleFileChange}
                className="hidden"
              />

              {file ? (
                <div className="flex items-center justify-between gap-3 text-left">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 shrink-0">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {file.name}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {(file.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 shrink-0"
                    onClick={e => {
                      e.stopPropagation();
                      resetState();
                    }}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <FileSpreadsheet className="w-7 h-7 text-slate-400 dark:text-slate-500 mx-auto" />
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Click to select Hemkosh dataset file
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Supports <span className="font-mono text-indigo-600 dark:text-indigo-400">.xls</span>,{' '}
                    <span className="font-mono text-indigo-600 dark:text-indigo-400">.xlsx</span>,{' '}
                    <span className="font-mono text-indigo-600 dark:text-indigo-400">.jsonl</span>,{' '}
                    <span className="font-mono text-indigo-600 dark:text-indigo-400">.json</span>,{' '}
                    <span className="font-mono text-indigo-600 dark:text-indigo-400">.csv</span>, or{' '}
                    <span className="font-mono text-indigo-600 dark:text-indigo-400">.tsv</span>
                  </p>
                </div>
              )}
            </div>

            {/* Duplicate policy */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Duplicate Handling
              </label>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setMode('skip')}
                  className={`p-2.5 rounded-lg border text-left transition-all ${
                    mode === 'skip'
                      ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/40 text-indigo-950 dark:text-indigo-200 font-medium'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <div className="font-semibold text-[11px]">Skip Existing</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    Leave existing senses and annotations untouched
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('overwrite')}
                  className={`p-2.5 rounded-lg border text-left transition-all ${
                    mode === 'overwrite'
                      ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/40 text-indigo-950 dark:text-indigo-200 font-medium'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <div className="font-semibold text-[11px]">Overwrite Gloss</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    Update description/examples if word & label match
                  </div>
                </button>
              </div>
            </div>

            {/* Footer controls */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleOpenChange(false)}
                disabled={submitting}
                className="h-8 text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={!file || submitting}
                className="h-8 text-xs bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Importing Senses...
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-3.5 h-3.5" />
                    Import Senses
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
