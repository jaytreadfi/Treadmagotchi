/**
 * EvolutionTracker — gated by cumulative trading volume.
 * Every bot contributes volume regardless of PnL outcome.
 */
import { EVOLUTION_ORDER, EVOLUTION_THRESHOLDS } from '@/lib/constants';
import type { EvolutionStage } from '@/lib/types';

function getStageForVolume(cumulativeVolume: number): EvolutionStage {
  let result: EvolutionStage = 'EGG';
  for (const stage of EVOLUTION_ORDER) {
    if (cumulativeVolume >= EVOLUTION_THRESHOLDS[stage]) {
      result = stage;
    } else {
      break;
    }
  }
  return result;
}

export function checkEvolution(currentStage: EvolutionStage, cumulativeVolume: number): {
  evolved: boolean;
  newStage: EvolutionStage;
} {
  const newStage = getStageForVolume(cumulativeVolume);
  const currentIdx = EVOLUTION_ORDER.indexOf(currentStage);
  const newIdx = EVOLUTION_ORDER.indexOf(newStage);

  return {
    evolved: newIdx > currentIdx,
    newStage,
  };
}

export function getEvolutionProgress(cumulativeVolume: number, currentStage: EvolutionStage): {
  currentThreshold: number;
  nextThreshold: number | null;
  progressPct: number;
} {
  const currentIdx = EVOLUTION_ORDER.indexOf(currentStage);
  const currentThreshold = EVOLUTION_THRESHOLDS[currentStage];
  const nextStage = EVOLUTION_ORDER[currentIdx + 1];
  const nextThreshold = nextStage ? EVOLUTION_THRESHOLDS[nextStage] : null;

  if (nextThreshold === null) {
    return { currentThreshold, nextThreshold: null, progressPct: 100 };
  }

  const range = nextThreshold - currentThreshold;
  const progress = cumulativeVolume - currentThreshold;
  const progressPct = Math.min(100, Math.max(0, (progress / range) * 100));

  return { currentThreshold, nextThreshold, progressPct };
}
