'use client';

import { usePetStore } from '@/store/usePetStore';
import { useTradingStore } from '@/store/useTradingStore';
import { useConfigStore } from '@/store/useConfigStore';

export default function StatusBar() {
  const stage = usePetStore((s) => s.stage);
  const mood = usePetStore((s) => s.mood);
  const name = usePetStore((s) => s.name);
  const account = useTradingStore((s) => s.account);
  const mode = useConfigStore((s) => s.mode);

  return (
    <div className="flex items-center justify-between px-3 py-2 bg-pixel-dark border-b border-white/10 text-[8px]">
      <div className="flex items-center gap-3">
        <span className="text-pixel-accent">{name}</span>
        <span className="opacity-50">{stage}</span>
        <span className="opacity-50">{mood}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className={mode === 'auto' ? 'text-pixel-green' : 'text-pixel-yellow'}>
          {mode === 'auto' ? 'AUTO' : 'MANUAL'}
        </span>
        {account && (
          <span className="text-pixel-green">${account.equity.toFixed(2)}</span>
        )}
      </div>
    </div>
  );
}
