'use client';

import { create } from 'zustand';
import type { PetMode, TreadAccount } from '@/lib/types';
import { pickData } from './utils';

const CONFIG_DATA_KEYS = [
  'treadfi_api_key_configured',
  'anthropic_api_key_configured',
  'pet_name',
  'mode',
  'decision_interval_seconds',
  'initial_capital',
  'onboarded',
  'accounts',
];

interface ConfigState {
  treadfi_api_key_configured: boolean;
  anthropic_api_key_configured: boolean;
  pet_name: string;
  mode: PetMode;
  decision_interval_seconds: number;
  initial_capital: number;
  onboarded: boolean;
  accounts: TreadAccount[];

  // Hydrate from server state
  hydrate: (data: Partial<ConfigState>) => void;
  setMode: (mode: PetMode) => void;
  setAccounts: (accounts: TreadAccount[]) => void;
  toggleAccount: (accountName: string) => void;
}

export const useConfigStore = create<ConfigState>()((set) => ({
  treadfi_api_key_configured: false,
  anthropic_api_key_configured: false,
  pet_name: 'Tready',
  mode: 'auto',
  decision_interval_seconds: 300,
  initial_capital: 100,
  onboarded: false,
  accounts: [],

  hydrate: (data) => set(pickData(data, CONFIG_DATA_KEYS)),
  setMode: (mode) => set({ mode }),
  setAccounts: (accounts) => set({ accounts }),
  toggleAccount: (accountName) =>
    set((s) => ({
      accounts: s.accounts.map((a) =>
        a.name === accountName ? { ...a, enabled: !a.enabled } : a,
      ),
    })),
}));
