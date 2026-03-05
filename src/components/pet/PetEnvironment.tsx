'use client';

import PetCanvas from './PetCanvas';
import { usePetStore } from '@/store/usePetStore';
import { getEvolutionProgress } from '@/lib/pet/evolutionTracker';
import { EVOLUTION_ORDER } from '@/lib/constants';

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

export default function PetEnvironment() {
  const name = usePetStore((s) => s.name);
  const stage = usePetStore((s) => s.stage);
  const cumulativeVolume = usePetStore((s) => s.cumulative_volume);
  const { progressPct } = getEvolutionProgress(cumulativeVolume, stage);

  const stageIdx = EVOLUTION_ORDER.indexOf(stage);
  const nextStage = EVOLUTION_ORDER[stageIdx + 1];

  return (
    <div className="flex flex-col items-center w-full px-6 py-4">
      {/* Wide RPG-framed canvas area */}
      <div className="rpg-frame w-full max-w-4xl aspect-[16/9] min-h-[300px] p-3 flex items-center justify-center">
        <div className="w-full h-full">
          <PetCanvas />
        </div>
      </div>

      <div className="w-full max-w-4xl mt-3">
        {/* Centered pet name */}
        <div className="text-center py-1">
          <span className="text-gold text-lg font-pixel">{name}</span>
        </div>

        {/* Evolution progress bar */}
        <div className="mt-2">
          <div className="flex items-center gap-3 text-sm">
            <span className="text-xp">{stage}</span>
            <div className="flex-1 h-4 stat-bar-track rounded-sm overflow-hidden border border-gold-dim/30">
              <div
                className="h-full bg-xp transition-all duration-1000"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-xp/60">{nextStage ?? 'MAX'}</span>
          </div>
          <div className="text-center text-xs text-white/30 mt-1">
            {formatVolume(cumulativeVolume)} volume
          </div>
        </div>
      </div>
    </div>
  );
}
