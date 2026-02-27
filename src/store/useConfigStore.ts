'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PetMode, TreadAccount } from '@/lib/types';

interface ConfigState {
  treadfi_api_key: string;
  anthropic_api_key: string;
  pet_name: string;
  mode: PetMode;
  decision_interval_seconds: number;
  initial_capital: number;
  onboarded: boolean;
  accounts: TreadAccount[];

  setApiKey: (key: string) => void;
  setAnthropicKey: (key: string) => void;
  setPetName: (name: string) => void;
  setMode: (mode: PetMode) => void;
  setDecisionInterval: (seconds: number) => void;
  setInitialCapital: (amount: number) => void;
  setOnboarded: (value: boolean) => void;
  setAccounts: (accounts: TreadAccount[]) => void;
  toggleAccount: (accountName: string) => void;
  getEnabledAccounts: () => TreadAccount[];
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set, get) => ({
      treadfi_api_key: '',
      anthropic_api_key: '',
      pet_name: 'Tready',
      mode: 'auto',
      decision_interval_seconds: 300,
      initial_capital: 100,
      onboarded: false,
      accounts: [],

      setApiKey: (key) => {
        if (typeof window !== 'undefined') localStorage.setItem('treadfi_api_key', key);
        set({ treadfi_api_key: key });
      },
      setAnthropicKey: (key) => {
        if (typeof window !== 'undefined') localStorage.setItem('anthropic_api_key', key);
        set({ anthropic_api_key: key });
      },
      setPetName: (name) => set({ pet_name: name }),
      setMode: (mode) => set({ mode }),
      setDecisionInterval: (seconds) => set({ decision_interval_seconds: seconds }),
      setInitialCapital: (amount) => {
        if (typeof window !== 'undefined') localStorage.setItem('initial_capital', String(amount));
        set({ initial_capital: amount });
      },
      setOnboarded: (value) => set({ onboarded: value }),
      setAccounts: (accounts) => set({ accounts }),
      toggleAccount: (accountName) =>
        set((s) => ({
          accounts: s.accounts.map((a) =>
            a.name === accountName ? { ...a, enabled: !a.enabled } : a,
          ),
        })),
      getEnabledAccounts: () => get().accounts.filter((a) => a.enabled),
    }),
    {
      name: 'treadmagotchi-config',
    },
  ),
);
