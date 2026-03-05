'use client';

import { useState, useEffect } from 'react';
import { useTradingStore } from '@/store/useTradingStore';
import { useConfigStore } from '@/store/useConfigStore';

interface HeaderBarProps {
  clockOffset: number;
  onGearClick: () => void;
}

export default function HeaderBar({ clockOffset, onGearClick }: HeaderBarProps) {
  const nextDecisionAt = useTradingStore((s) => s.nextDecisionAt);
  const engineRunning = useTradingStore((s) => s.engineRunning);
  const mode = useConfigStore((s) => s.mode);
  const interval = useConfigStore((s) => s.decision_interval_seconds);

  const [secondsLeft, setSecondsLeft] = useState(0);
  const [scanning, setScanning] = useState(false);

  const showTimer = engineRunning && mode === 'auto';

  useEffect(() => {
    if (!showTimer) {
      setSecondsLeft(0);
      return;
    }

    const tick = () => {
      if (!nextDecisionAt) {
        setSecondsLeft(0);
        setScanning(true);
        return;
      }
      const serverNow = Date.now() + clockOffset;
      const remaining = Math.max(0, (nextDecisionAt - serverNow) / 1000);
      setSecondsLeft(Math.ceil(remaining));
      setScanning(remaining <= 2);
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [nextDecisionAt, showTimer, clockOffset]);

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
  const pct = interval > 0 ? ((interval - secondsLeft) / interval) * 100 : 0;

  return (
    <div className="flex items-center gap-4 px-5 py-2.5 bg-panel border-b-2 border-gold-dim/40">
      {showTimer ? (
        <>
          <span className={`text-xs font-pixel whitespace-nowrap ${scanning ? 'text-hunger animate-scan-pulse' : 'text-energy'}`}>
            {scanning ? 'SCANNING...' : `NEXT SCAN ${timeStr}`}
          </span>
          <div className="flex-1 h-3 stat-bar-track rounded-sm overflow-hidden">
            <div
              className={`h-full transition-all duration-1000 ${scanning ? 'bg-hunger' : 'bg-energy'}`}
              style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
            />
          </div>
        </>
      ) : (
        <span className="flex-1 text-xs font-pixel text-gold-dim/60">TREADMAGOTCHI</span>
      )}

      <button
        onClick={onGearClick}
        className="text-gold-dim hover:text-gold transition-colors p-1 cursor-pointer"
        aria-label="Settings"
      >
        <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
          <path d="M6.5 1h3v1.5h1V1h1v2.5h-1V3h-1v1h-1V3h-1V1zm-2 4h7V4h1v1h1v1h1v3h-1v1h-1v1h-1v1h-1v1.5h-1V14h-1v-1.5h-1V11h-1v-1h-1V9H3V6h1V5h.5zm2 2v3h3V7h-3z"/>
        </svg>
      </button>
    </div>
  );
}
