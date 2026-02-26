'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PetState, PetVitals, PetMood, EvolutionStage } from '@/lib/types';

interface PetStore extends PetState {
  setVitals: (vitals: Partial<PetVitals>) => void;
  setMood: (mood: PetMood) => void;
  setStage: (stage: EvolutionStage) => void;
  setCumulativeVolume: (vol: number) => void;
  addVolume: (vol: number) => void;
  setConsecutiveLosses: (count: number) => void;
  setLastTradeTime: (time: number | null) => void;
  setIsAlive: (alive: boolean) => void;
  setJustEvolved: (evolved: boolean) => void;
  setSpeechBubble: (text: string | null, durationMs?: number) => void;
  setLastSaveTime: (time: number) => void;
  reset: () => void;
}

const DEFAULT_PET: PetState = {
  name: 'Tready',
  mode: 'auto',
  vitals: { hunger: 100, happiness: 70, energy: 100, health: 100 },
  mood: 'content',
  stage: 'EGG',
  cumulative_volume: 0,
  consecutive_losses: 0,
  last_trade_time: null,
  last_save_time: Date.now(),
  is_alive: true,
  just_evolved: false,
  speech_bubble: null,
  speech_bubble_until: null,
};

export const usePetStore = create<PetStore>()(
  persist(
    (set) => ({
      ...DEFAULT_PET,

      setVitals: (partial) =>
        set((s) => ({
          vitals: {
            hunger: Math.max(0, Math.min(100, partial.hunger ?? s.vitals.hunger)),
            happiness: Math.max(0, Math.min(100, partial.happiness ?? s.vitals.happiness)),
            energy: Math.max(0, Math.min(100, partial.energy ?? s.vitals.energy)),
            health: Math.max(0, Math.min(100, partial.health ?? s.vitals.health)),
          },
        })),
      setMood: (mood) => set({ mood }),
      setStage: (stage) => set({ stage }),
      setCumulativeVolume: (vol) => set({ cumulative_volume: vol }),
      addVolume: (vol) =>
        set((s) => ({
          cumulative_volume: s.cumulative_volume + Math.abs(vol),
        })),
      setConsecutiveLosses: (count) => set({ consecutive_losses: count }),
      setLastTradeTime: (time) => set({ last_trade_time: time }),
      setIsAlive: (alive) => set({ is_alive: alive }),
      setJustEvolved: (evolved) => set({ just_evolved: evolved }),
      setSpeechBubble: (text, durationMs = 5000) =>
        set({
          speech_bubble: text,
          speech_bubble_until: text ? Date.now() + durationMs : null,
        }),
      setLastSaveTime: (time) => set({ last_save_time: time }),
      reset: () => set({ ...DEFAULT_PET, last_save_time: Date.now() }),
    }),
    {
      name: 'treadmagotchi-pet',
    },
  ),
);
