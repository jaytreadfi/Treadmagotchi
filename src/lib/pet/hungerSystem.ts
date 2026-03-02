/**
 * HungerSystem — manages hunger decay and starvation.
 * Manual mode: hunger decays at 0.5/min (~3.3h full->empty).
 * Auto mode: no hunger decay, replenished by profitable trades.
 */
import { HUNGER_DECAY_PER_MIN, MAX_STARVATION_DAMAGE_MINS } from '@/lib/constants';
import type { PetMode } from '@/lib/types';

function calculateHungerDecay(
  currentHunger: number,
  elapsedMinutes: number,
  mode: PetMode,
): number {
  if (mode === 'auto') return currentHunger; // no decay in auto
  return Math.max(0, currentHunger - elapsedMinutes * HUNGER_DECAY_PER_MIN);
}

function calculateStarvationDamage(
  starvationMinutes: number,
): number {
  // Cap damage at MAX_STARVATION_DAMAGE_MINS (120 = 2h)
  return Math.min(starvationMinutes, MAX_STARVATION_DAMAGE_MINS);
}

export function applyOfflineDecay(
  currentHunger: number,
  currentHealth: number,
  elapsedMinutes: number,
  mode: PetMode,
): { hunger: number; health: number } {
  if (mode === 'auto') return { hunger: currentHunger, health: currentHealth };

  const newHunger = calculateHungerDecay(currentHunger, elapsedMinutes, mode);

  let healthDamage = 0;
  if (newHunger <= 0) {
    // Time spent at 0 hunger
    const timeToZero = currentHunger / HUNGER_DECAY_PER_MIN;
    const starvationMinutes = Math.max(0, elapsedMinutes - timeToZero);
    healthDamage = calculateStarvationDamage(starvationMinutes);
  }

  return {
    hunger: newHunger,
    health: Math.max(0, currentHealth - healthDamage),
  };
}

export function feedPet(currentHunger: number, tradePnl: number): number {
  // Profitable trade: +25 hunger. Loss: +10 hunger.
  const amount = tradePnl > 0 ? 25 : 10;
  return Math.min(100, currentHunger + amount);
}
