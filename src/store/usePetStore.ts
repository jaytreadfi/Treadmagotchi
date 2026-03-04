'use client';

import { create } from 'zustand';
import type { PetVitals, PetMood, EvolutionStage } from '@/lib/types';
import { pickData } from './utils';

const PET_DATA_KEYS = [
  'name',
  'vitals',
  'mood',
  'stage',
  'cumulative_volume',
  'consecutive_losses',
  'last_trade_time',
  'is_alive',
  'evolved_at',
  'egg_id',
  'character_id',
  'speech_bubble',
  'speech_bubble_until',
];

interface PetStore {
  name: string;
  vitals: PetVitals;
  mood: PetMood;
  stage: EvolutionStage;
  cumulative_volume: number;
  consecutive_losses: number;
  last_trade_time: number | null;
  is_alive: boolean;
  evolved_at: number | null;
  egg_id: number | null;
  character_id: string | null;
  speech_bubble: string | null;
  speech_bubble_until: number | null;

  hydrate: (data: Partial<PetStore>) => void;
  setVitals: (vitals: Partial<PetVitals>) => void;
  setStage: (stage: EvolutionStage) => void;
  setEvolvedAt: (time: number | null) => void;
  setSpeechBubble: (text: string | null, durationMs?: number) => void;
}

const DEFAULT_VITALS: PetVitals = {
  hunger: 100,
  happiness: 70,
  energy: 100,
  health: 100,
};

export const usePetStore = create<PetStore>()((set) => ({
  name: 'Tready',
  vitals: { ...DEFAULT_VITALS },
  mood: 'content',
  stage: 'EGG',
  cumulative_volume: 0,
  consecutive_losses: 0,
  last_trade_time: null,
  is_alive: true,
  evolved_at: null,
  egg_id: null,
  character_id: null,
  speech_bubble: null,
  speech_bubble_until: null,

  hydrate: (data) => set(pickData(data, PET_DATA_KEYS)),
  setVitals: (partial) =>
    set((s) => ({
      vitals: {
        hunger: Math.max(0, Math.min(100, partial.hunger ?? s.vitals.hunger)),
        happiness: Math.max(0, Math.min(100, partial.happiness ?? s.vitals.happiness)),
        energy: Math.max(0, Math.min(100, partial.energy ?? s.vitals.energy)),
        health: Math.max(0, Math.min(100, partial.health ?? s.vitals.health)),
      },
    })),
  setStage: (stage) => set({ stage }),
  setEvolvedAt: (time) => set({ evolved_at: time }),
  setSpeechBubble: (text, durationMs = 5000) =>
    set({
      speech_bubble: text,
      speech_bubble_until: text ? Date.now() + durationMs : null,
    }),
}));
