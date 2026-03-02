'use client';

import { useEffect, useRef } from 'react';
import { useConfigStore } from '@/store/useConfigStore';
import { useTradingStore } from '@/store/useTradingStore';
import { startEngine, stopEngine } from '@/engine/scheduler/loopScheduler';
import { initPetState } from '@/engine/pet/petStateMachine';
import { getActivityByCategory } from '@/persistence/db';
import type { DecisionLogEntry } from '@/lib/types';

export function useTradingLoop() {
  const onboarded = useConfigStore((s) => s.onboarded);
  const mode = useConfigStore((s) => s.mode);
  const initialized = useRef(false);

  useEffect(() => {
    if (!onboarded) return;

    if (!initialized.current) {
      initPetState();
      initialized.current = true;

      // Hydrate decision log from IndexedDB after Zustand persist finishes
      const unsub = useTradingStore.persist.onFinishHydration(() => {
        unsub();
        getActivityByCategory('decision', 50).then((entries) => {
          if (!entries.length) return;
          const store = useTradingStore.getState();
          // Only hydrate if the store is empty (localStorage was cleared)
          if (store.decisionLog.length > 0) return;

          const hydrated: DecisionLogEntry[] = entries
            .sort((a, b) => a.timestamp - b.timestamp)
            .map((e) => {
              const d = JSON.parse(e.detail);
              return {
                timestamp: new Date(e.timestamp).toISOString(),
                action: e.action === 'trade' ? 'market_make' : e.action,
                pair: e.pair,
                reasoning: d.reasoning || '',
                active_pairs: d.active_pairs || [],
                calm_pairs: d.calm_pairs || [],
                portfolio: d.portfolio || { balance: 0, equity: 0, unrealized_pnl: 0, exposure_pct: 0 },
              };
            });
          store.setDecisionLog(hydrated);
        }).catch(() => { /* non-fatal */ });
      });
    }

    if (mode === 'auto') {
      startEngine();
    } else {
      stopEngine();
    }

    return () => {
      stopEngine();
    };
  }, [onboarded, mode]);
}
