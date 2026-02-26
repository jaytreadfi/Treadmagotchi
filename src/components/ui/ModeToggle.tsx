'use client';

import { useConfigStore } from '@/store/useConfigStore';

export default function ModeToggle() {
  const mode = useConfigStore((s) => s.mode);
  const setMode = useConfigStore((s) => s.setMode);

  const toggle = () => {
    setMode(mode === 'auto' ? 'manual' : 'auto');
  };

  return (
    <button
      onClick={toggle}
      className={`px-3 py-1 text-[8px] border rounded transition-colors ${
        mode === 'auto'
          ? 'border-pixel-green text-pixel-green hover:bg-pixel-green/10'
          : 'border-pixel-yellow text-pixel-yellow hover:bg-pixel-yellow/10'
      }`}
    >
      {mode === 'auto' ? 'AUTO' : 'MANUAL'}
    </button>
  );
}
