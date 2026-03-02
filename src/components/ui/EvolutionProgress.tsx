'use client';

import { usePetStore } from '@/store/usePetStore';
import { getEvolutionProgress } from '@/lib/pet/evolutionTracker';
import { EVOLUTION_ORDER } from '@/lib/constants';

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

export default function EvolutionProgress() {
  const stage = usePetStore((s) => s.stage);
  const cumulativeVolume = usePetStore((s) => s.cumulative_volume);
  const { nextThreshold, progressPct } = getEvolutionProgress(cumulativeVolume, stage);

  const stageIdx = EVOLUTION_ORDER.indexOf(stage);
  const nextStage = EVOLUTION_ORDER[stageIdx + 1];

  return (
    <div className="w-full max-w-xs mx-auto px-2">
      <div className="flex justify-between text-[7px] mb-1 opacity-60">
        <span>{stage}</span>
        <span>{nextStage ? `→ ${nextStage}` : 'MAX'}</span>
      </div>
      <div className="h-2 bg-pixel-dark rounded-sm overflow-hidden border border-white/10">
        <div
          className="h-full bg-gradient-to-r from-pixel-accent to-pixel-yellow transition-all duration-1000"
          style={{ width: `${progressPct}%` }}
        />
      </div>
      <div className="text-center text-[7px] mt-1 opacity-40">
        {formatVolume(cumulativeVolume)} volume
        {nextThreshold !== null && ` / ${formatVolume(nextThreshold)} to evolve`}
      </div>
    </div>
  );
}
