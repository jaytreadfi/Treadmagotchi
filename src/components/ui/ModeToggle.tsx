'use client';

import { useState } from 'react';
import { useConfigStore } from '@/store/useConfigStore';

export default function ModeToggle() {
  const mode = useConfigStore((s) => s.mode);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    if (loading) return;
    const newMode = mode === 'auto' ? 'manual' : 'auto';

    // Optimistic update
    const prevMode = mode;
    useConfigStore.getState().setMode(newMode);

    setLoading(true);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',

        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      });
      if (!res.ok) {
        // Rollback on failure
        useConfigStore.getState().setMode(prevMode);
      }
    } catch {
      // Rollback on network error
      useConfigStore.getState().setMode(prevMode);
    }
    setLoading(false);
  };

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className={`px-3 py-1 text-[8px] border rounded transition-colors disabled:opacity-50 ${
        mode === 'auto'
          ? 'border-pixel-green text-pixel-green hover:bg-pixel-green/10'
          : 'border-pixel-yellow text-pixel-yellow hover:bg-pixel-yellow/10'
      }`}
    >
      {loading ? '...' : mode === 'auto' ? 'AUTO' : 'MANUAL'}
    </button>
  );
}
