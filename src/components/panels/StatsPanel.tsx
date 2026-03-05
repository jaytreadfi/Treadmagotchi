'use client';

import VitalBars from '@/components/stats/VitalBars';
import { useTradingStore } from '@/store/useTradingStore';
import { usePetStore } from '@/store/usePetStore';

function fmt(n: number | undefined): string {
  if (n == null) return '---';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

export default function StatsPanel() {
  const account = useTradingStore((s) => s.account);
  const volume = usePetStore((s) => s.cumulative_volume);

  return (
    <div className="p-5 flex flex-col gap-4">
      <h3 className="text-sm text-gold uppercase">Stats</h3>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <span className="text-white/40 uppercase text-[10px] block">Bal</span>
          <span className="text-joy">{fmt(account?.balance)}</span>
        </div>
        <div>
          <span className="text-white/40 uppercase text-[10px] block">Eq</span>
          <span className="text-joy">{fmt(account?.equity)}</span>
        </div>
        <div>
          <span className="text-white/40 uppercase text-[10px] block">Vol</span>
          <span className="text-hunger">{fmt(volume)}</span>
        </div>
      </div>

      <div className="border-t border-gold-dim/20 pt-3">
        <VitalBars />
      </div>
    </div>
  );
}
