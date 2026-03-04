'use client';

import { useEffect } from 'react';
import PixelButton from './PixelButton';

interface ConfirmDialogProps {
  open: boolean;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({ open, message, onConfirm, onCancel }: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <div
        className="border-2 border-white/30 bg-pixel-black px-6 py-5 text-center font-pixel"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-4 text-[10px] text-white/90">{message}</p>
        <div className="flex justify-center gap-3">
          <PixelButton onClick={onConfirm} variant="danger">
            Confirm
          </PixelButton>
          <PixelButton onClick={onCancel} variant="ghost">
            Cancel
          </PixelButton>
        </div>
      </div>
    </div>
  );
}
