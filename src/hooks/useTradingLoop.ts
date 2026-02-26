'use client';

import { useEffect, useRef } from 'react';
import { useConfigStore } from '@/store/useConfigStore';
import { startEngine, stopEngine } from '@/engine/scheduler/loopScheduler';
import { initPetState } from '@/engine/pet/petStateMachine';

export function useTradingLoop() {
  const onboarded = useConfigStore((s) => s.onboarded);
  const mode = useConfigStore((s) => s.mode);
  const initialized = useRef(false);

  useEffect(() => {
    if (!onboarded) return;

    if (!initialized.current) {
      initPetState();
      initialized.current = true;
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
