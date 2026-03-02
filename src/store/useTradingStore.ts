'use client';

import { create } from 'zustand';
import type { Position, AccountInfo, RiskMetrics, DecisionLogEntry } from '@/lib/types';
import { pickData } from './utils';

const TRADING_DATA_KEYS = [
  'account',
  'positions',
  'riskMetrics',
  'decisionLog',
  'engineRunning',
  'lastDecisionTime',
  'lastSyncTime',
  'nextDecisionAt',
  'serverEpoch',
  'activeBots',
];

interface TradingState {
  account: AccountInfo | null;
  positions: Position[];
  riskMetrics: RiskMetrics | null;
  decisionLog: DecisionLogEntry[];
  engineRunning: boolean;
  lastDecisionTime: number | null;
  lastSyncTime: number | null;
  nextDecisionAt: number | null;
  serverEpoch: number;
  activeBots: Array<Record<string, unknown>>;

  hydrate: (data: Partial<TradingState>) => void;
  setAccount: (account: AccountInfo) => void;
  setPositions: (positions: Position[]) => void;
  setRiskMetrics: (metrics: RiskMetrics) => void;
  addDecision: (entry: DecisionLogEntry) => void;
  setDecisionLog: (log: DecisionLogEntry[]) => void;
  setLastDecisionTime: (time: number) => void;
  setNextDecisionAt: (time: number | null) => void;
  setActiveBots: (bots: Array<Record<string, unknown>>) => void;
}

const MAX_DECISIONS = 50;

export const useTradingStore = create<TradingState>()((set) => ({
  account: null,
  positions: [],
  riskMetrics: null,
  decisionLog: [],
  engineRunning: false,
  lastDecisionTime: null,
  lastSyncTime: null,
  nextDecisionAt: null,
  serverEpoch: 0,
  activeBots: [],

  hydrate: (data) => set(pickData(data, TRADING_DATA_KEYS)),
  setAccount: (account) => set({ account }),
  setPositions: (positions) => set({ positions }),
  setRiskMetrics: (metrics) => set({ riskMetrics: metrics }),
  addDecision: (entry) =>
    set((s) => ({
      decisionLog: [...s.decisionLog.slice(-(MAX_DECISIONS - 1)), entry],
    })),
  setDecisionLog: (log) => set({ decisionLog: log }),
  setLastDecisionTime: (time) => set({ lastDecisionTime: time }),
  setNextDecisionAt: (time) => set({ nextDecisionAt: time }),
  setActiveBots: (bots) => set({ activeBots: bots }),
}));
