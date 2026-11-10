'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export interface NewSenseValues {
  word: string;
  senseLabel: string;
  gloss: string;
  examples: string;
}

interface WsdAddSenseFormProps {
  /** Word the sense belongs to (the selected token). */
  word: string;
  /** Let the annotator correct the word, e.g. when registering an unlisted word. */
  wordEditable?: boolean;
  submitLabel: string;
  /** Resolves to an error message to show inline, or null on success. */
  onSubmit: (values: NewSenseValues) => Promise<string | null>;
}

/** Sense / Gloss / Example form shared by "Add New" (listed word) and "Register ambiguous word". */
export function WsdAddSenseForm({ word, wordEditable = false, submitLabel, onSubmit }: WsdAddSenseFormProps) {
  const [wordValue, setWordValue] = useState(word);
  const [senseLabel, setSenseLabel] = useState('');
  const [gloss, setGloss] = useState('');
  const [examples, setExamples] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!wordValue.trim() || !senseLabel.trim()) return;
    setSubmitting(true);
    setError(null);
    const message = await onSubmit({
      word: wordValue.trim(),
      senseLabel: senseLabel.trim(),
      gloss,
      examples,
    });
    setSubmitting(false);
    if (message) {
      setError(message);
      return;
    }
    setSenseLabel('');
    setGloss('');
    setExamples('');
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      {wordEditable ? (
        <Input value={wordValue} onChange={e => setWordValue(e.target.value)} placeholder="Word" required />
      ) : (
        <div className="text-xs text-slate-500">
          Word: <span className="font-semibold text-slate-900 dark:text-white">{word}</span>
        </div>
      )}
      <Input
        value={senseLabel}
        onChange={e => setSenseLabel(e.target.value)}
        placeholder="Sense (e.g. সময়/যুগ)"
        required
      />
      <Textarea value={gloss} onChange={e => setGloss(e.target.value)} placeholder="Gloss (meaning)" rows={2} />
      <Textarea value={examples} onChange={e => setExamples(e.target.value)} placeholder="Example sentence(s)" rows={2} />
      {error && (
        <p className="rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      <Button type="submit" size="sm" disabled={submitting} className="w-full">
        {submitting ? 'Saving…' : submitLabel}
      </Button>
    </form>
  );
}
