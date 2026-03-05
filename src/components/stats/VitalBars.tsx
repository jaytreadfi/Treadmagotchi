'use client';

import { usePetStore } from '@/store/usePetStore';

const BARS = [
  { key: 'health', label: 'HP', color: 'bg-hp' },
  { key: 'hunger', label: 'HNG', color: 'bg-hunger' },
  { key: 'happiness', label: 'JOY', color: 'bg-joy' },
  { key: 'energy', label: 'NRG', color: 'bg-energy' },
] as const;

export default function VitalBars() {
  const vitals = usePetStore((s) => s.vitals);

  return (
    <div className="flex flex-col gap-2.5">
      {BARS.map(({ key, label, color }) => (
        <div key={key} className="flex items-center gap-3">
          <span className="text-xs w-10 text-right text-gold-dim uppercase">{label}</span>
          <div className="flex-1 h-4 stat-bar-track rounded-sm overflow-hidden border border-gold-dim/20">
            <div
              className={`h-full ${color} transition-all duration-500`}
              style={{ width: `${vitals[key]}%` }}
            />
          </div>
          <span className="text-xs w-10 text-white/40 text-right">{Math.round(vitals[key])}</span>
        </div>
      ))}
    </div>
  );
}
