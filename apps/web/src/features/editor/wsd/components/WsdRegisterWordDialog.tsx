'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { WsdAddSenseForm, type NewSenseValues } from '@/features/editor/wsd/components/WsdAddSenseForm';

interface WsdRegisterWordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The word the annotator clicked, which is not yet in the ambiguous-word list. */
  word: string;
  onSubmit: (values: NewSenseValues) => Promise<string | null>;
}

/** Registers a word the annotator found ambiguous that the dictionary doesn't list yet. */
export function WsdRegisterWordDialog({ open, onOpenChange, word, onSubmit }: WsdRegisterWordDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px] p-6 gap-4">
        <DialogHeader className="gap-1.5">
          <DialogTitle>Register ambiguous word</DialogTitle>
          <DialogDescription>
            Add the sense of <span className="font-semibold">{word}</span> used in this sentence. It joins the
            ambiguous-word list and is highlighted wherever it appears.
          </DialogDescription>
        </DialogHeader>
        {/* key remounts the form per word so stale input never carries over */}
        <WsdAddSenseForm
          key={word}
          word={word}
          wordEditable
          submitLabel="Register & select sense"
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}
