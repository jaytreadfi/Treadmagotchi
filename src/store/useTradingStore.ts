'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Position, AccountInfo, RiskMetrics, DecisionLogEntry } from '@/lib/types';

interface TradingState {
  account: AccountInfo | null;
  positions: Position[];
  riskMetrics: RiskMetrics | null;
  decisionLog: DecisionLogEntry[];
  engineRunning: boolean;
  lastDecisionTime: number | null;
  lastSyncTime: number | null;

  setAccount: (account: AccountInfo) => void;
  setPositions: (positions: Position[]) => void;
  setRiskMetrics: (metrics: RiskMetrics) => void;
  addDecision: (entry: DecisionLogEntry) => void;
  setDecisionLog: (log: DecisionLogEntry[]) => void;
  setEngineRunning: (running: boolean) => void;
  setLastDecisionTime: (time: number) => void;
  setLastSyncTime: (time: number) => void;
}

const MAX_DECISIONS = 50;

export const useTradingStore = create<TradingState>()(
  persist(
    (set) => ({
      account: null,
      positions: [],
      riskMetrics: null,
      decisionLog: [],
      engineRunning: false,
      lastDecisionTime: null,
      lastSyncTime: null,

      setAccount: (account) => set({ account }),
      setPositions: (positions) => set({ positions }),
      setRiskMetrics: (metrics) => set({ riskMetrics: metrics }),
      addDecision: (entry) =>
        set((s) => ({
          decisionLog: [...s.decisionLog.slice(-(MAX_DECISIONS - 1)), entry],
        })),
      setDecisionLog: (log) => set({ decisionLog: log }),
      setEngineRunning: (running) => set({ engineRunning: running }),
      setLastDecisionTime: (time) => set({ lastDecisionTime: time }),
      setLastSyncTime: (time) => set({ lastSyncTime: time }),
    }),
    {
      name: 'treadmagotchi-trading',
      partialize: (state) => ({
        decisionLog: state.decisionLog,
        lastDecisionTime: state.lastDecisionTime,
        lastSyncTime: state.lastSyncTime,
      }),
    },
  ),
);
