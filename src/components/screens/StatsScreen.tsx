'use client';

import { useState, useEffect } from 'react';
import { useTradingStore } from '@/store/useTradingStore';
import { usePetStore } from '@/store/usePetStore';
import * as db from '@/persistence/db';
import type { TradeOutcome } from '@/lib/types';
import PixelButton from '@/components/ui/PixelButton';

interface StatsScreenProps {
  onClose: () => void;
}

export default function StatsScreen({ onClose }: StatsScreenProps) {
  const decisionLog = useTradingStore((s) => s.decisionLog);
  const stage = usePetStore((s) => s.stage);
  const cumulativeVolume = usePetStore((s) => s.cumulative_volume);
  const consecutiveLosses = usePetStore((s) => s.consecutive_losses);
  const [outcomes, setOutcomes] = useState<TradeOutcome[]>([]);

  useEffect(() => {
    db.getTradeOutcomes(20).then(setOutcomes);
  }, []);

  const wins = outcomes.filter((o) => o.outcome === 'win').length;
  const losses = outcomes.filter((o) => o.outcome === 'loss').length;
  const totalPnl = outcomes.reduce((sum, o) => sum + o.realized_pnl, 0);

  return (
    <div className="min-h-screen bg-pixel-bg p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs text-pixel-accent">STATS</h2>
        <PixelButton onClick={onClose} variant="ghost">Back</PixelButton>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-2 text-[8px] mb-4">
        <div className="bg-pixel-dark p-2 rounded">
          <div className="opacity-50">Stage</div>
          <div className="text-pixel-yellow">{stage}</div>
        </div>
        <div className="bg-pixel-dark p-2 rounded">
          <div className="opacity-50">Volume</div>
          <div className="text-pixel-green">${cumulativeVolume >= 1_000_000 ? `${(cumulativeVolume / 1_000_000).toFixed(1)}M` : cumulativeVolume >= 1_000 ? `${(cumulativeVolume / 1_000).toFixed(1)}K` : cumulativeVolume.toFixed(0)}</div>
        </div>
        <div className="bg-pixel-dark p-2 rounded">
          <div className="opacity-50">Win/Loss</div>
          <div>{wins}W / {losses}L</div>
        </div>
        <div className="bg-pixel-dark p-2 rounded">
          <div className="opacity-50">Total PnL</div>
          <div className={totalPnl >= 0 ? 'text-pixel-green' : 'text-pixel-red'}>
            ${totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Recent decisions */}
      <h3 className="text-[9px] text-pixel-accent mb-2">Recent Decisions</h3>
      <div className="flex flex-col gap-1 max-h-60 overflow-y-auto">
        {decisionLog.length === 0 && (
          <div className="text-[8px] opacity-30 text-center py-4">No decisions yet</div>
        )}
        {[...decisionLog].reverse().slice(0, 10).map((d, i) => (
          <div key={i} className="bg-pixel-dark/50 rounded p-2 text-[7px]">
            <div className="flex justify-between mb-1">
              <span className={d.action === 'market_make' ? 'text-pixel-green' : 'text-pixel-yellow'}>
                {d.action.toUpperCase()}
              </span>
              <span className="opacity-30">
                {new Date(d.timestamp).toLocaleTimeString()}
              </span>
            </div>
            {d.pair && <div className="text-pixel-blue">{d.pair}</div>}
            <div className="opacity-50 mt-1 line-clamp-2">{d.reasoning}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
