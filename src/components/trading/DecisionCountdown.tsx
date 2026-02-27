'use client';

import { useState, useEffect } from 'react';
import { useTradingStore } from '@/store/useTradingStore';
import { useConfigStore } from '@/store/useConfigStore';

export default function DecisionCountdown() {
  const lastDecisionTime = useTradingStore((s) => s.lastDecisionTime);
  const engineRunning = useTradingStore((s) => s.engineRunning);
  const mode = useConfigStore((s) => s.mode);
  const interval = useConfigStore((s) => s.decision_interval_seconds);
  const decisionLog = useTradingStore((s) => s.decisionLog);

  const [secondsLeft, setSecondsLeft] = useState(0);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    if (!engineRunning || mode !== 'auto') {
      setSecondsLeft(0);
      return;
    }

    const tick = () => {
      if (!lastDecisionTime) {
        setSecondsLeft(0);
        setScanning(true);
        return;
      }

      const elapsed = (Date.now() - lastDecisionTime) / 1000;
      const remaining = Math.max(0, interval - elapsed);
      setSecondsLeft(Math.ceil(remaining));
      setScanning(remaining <= 2);
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [lastDecisionTime, engineRunning, mode, interval]);

  if (!engineRunning || mode !== 'auto') return null;

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

  const lastDecision = decisionLog.length > 0 ? decisionLog[decisionLog.length - 1] : null;

  return (
    <div className="px-3 py-2 border-b border-white/5">
      {/* Countdown bar */}
      <div className="flex items-center gap-2 text-[7px]">
        <span className={scanning ? 'text-pixel-yellow animate-pulse' : 'text-pixel-blue'}>
          {scanning ? 'SCANNING...' : `NEXT SCAN ${timeStr}`}
        </span>
        <div className="flex-1 h-1 bg-pixel-dark rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-1000 ${scanning ? 'bg-pixel-yellow' : 'bg-pixel-blue'}`}
            style={{ width: `${interval > 0 ? ((interval - secondsLeft) / interval) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Last decision thought */}
      {lastDecision && (
        <div className="mt-1 text-[7px] opacity-50">
          <span className={lastDecision.action === 'market_make' ? 'text-pixel-green' : 'text-pixel-yellow'}>
            {lastDecision.action === 'market_make' ? 'TRADE' : 'HOLD'}
          </span>
          {lastDecision.pair && (
            <span className="text-pixel-blue ml-1">{lastDecision.pair}</span>
          )}
          <span className="ml-1">
            — {lastDecision.reasoning.length > 80
              ? lastDecision.reasoning.slice(0, 80) + '...'
              : lastDecision.reasoning}
          </span>
        </div>
      )}
    </div>
  );
}
