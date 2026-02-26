'use client';

import { usePetStore } from '@/store/usePetStore';

const BAR_CONFIG = [
  { key: 'health', label: 'HP', color: 'bg-pixel-red' },
  { key: 'hunger', label: 'HNG', color: 'bg-pixel-yellow' },
  { key: 'happiness', label: 'JOY', color: 'bg-pixel-green' },
  { key: 'energy', label: 'NRG', color: 'bg-pixel-blue' },
] as const;

export default function StatBars() {
  const vitals = usePetStore((s) => s.vitals);

  return (
    <div className="flex flex-col gap-1 w-full max-w-xs mx-auto px-2">
      {BAR_CONFIG.map(({ key, label, color }) => (
        <div key={key} className="flex items-center gap-2">
          <span className="text-[8px] w-8 text-right opacity-70">{label}</span>
          <div className="flex-1 h-2 bg-pixel-dark rounded-sm overflow-hidden border border-white/10">
            <div
              className={`h-full ${color} transition-all duration-500`}
              style={{ width: `${vitals[key]}%` }}
            />
          </div>
          <span className="text-[8px] w-8 opacity-50">{Math.round(vitals[key])}</span>
        </div>
      ))}
    </div>
  );
}
