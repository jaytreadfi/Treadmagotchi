/**
 * PetStateMachine — orchestrates vitals, mood, evolution, and hunger.
 * Evolution is gated by cumulative trading volume (not PnL).
 * PnL still drives mood/happiness.
 */
import { usePetStore } from '@/store/usePetStore';
import { useTradingStore } from '@/store/useTradingStore';
import { deriveMood, type MoodContext } from './moodEngine';
import { checkEvolution } from './evolutionTracker';
import { applyOfflineDecay, feedPet } from './hungerSystem';
import { MOOD_SPEECHES } from '@/lib/constants';
import * as db from '@/persistence/db';

let lastPnlForPet: number | null = null;
let lastPnlWasRecent = false;

export function initPetState(): void {
  const pet = usePetStore.getState();
  const elapsed = (Date.now() - pet.last_save_time) / 60000;

  if (elapsed > 1) {
    const { hunger, health } = applyOfflineDecay(
      pet.vitals.hunger,
      pet.vitals.health,
      elapsed,
      pet.mode,
    );
    pet.setVitals({ hunger, health });

    if (health <= 0 && pet.mode === 'manual') {
      pet.setIsAlive(false);
      pet.setMood('dead');
    }
  }

  pet.setLastSaveTime(Date.now());
}

export function tickPetState(): void {
  const pet = usePetStore.getState();
  const trading = useTradingStore.getState();

  if (!pet.is_alive) {
    pet.setMood('dead');
    return;
  }

  // Clear expired speech bubbles
  if (pet.speech_bubble_until && Date.now() > pet.speech_bubble_until) {
    pet.setSpeechBubble(null);
  }

  // Clear just_evolved flag after a few seconds
  if (pet.just_evolved) {
    setTimeout(() => usePetStore.getState().setJustEvolved(false), 8000);
  }

  const ctx: MoodContext = {
    vitals: pet.vitals,
    mode: pet.mode,
    isAlive: pet.is_alive,
    justEvolved: pet.just_evolved,
    consecutiveLosses: pet.consecutive_losses,
    lastTradeTime: pet.last_trade_time,
    lastTradePnl: lastPnlForPet,
    lastTradeWasRecent: lastPnlWasRecent,
    engineRunning: trading.engineRunning,
  };

  const newMood = deriveMood(ctx);
  if (newMood !== pet.mood) {
    pet.setMood(newMood);
    const speeches = MOOD_SPEECHES[newMood];
    if (speeches?.length) {
      const speech = speeches[Math.floor(Math.random() * speeches.length)];
      pet.setSpeechBubble(speech);
    }
  }

  if (pet.last_trade_time && Date.now() - pet.last_trade_time > 10 * 60000) {
    lastPnlWasRecent = false;
  }

  pet.setLastSaveTime(Date.now());
}

/**
 * Called when a bot completes. Volume drives evolution, PnL drives mood.
 * @param pnl — realized PnL from the completed bot
 * @param volume — total filled volume (both sides) from the completed bot
 */
export function onTradeCompleted(pnl: number, volume: number): void {
  const pet = usePetStore.getState();
  if (!pet.is_alive) return;

  // PnL → consecutive losses (mood)
  if (pnl < -0.001) {
    pet.setConsecutiveLosses(pet.consecutive_losses + 1);
  } else if (pnl > 0.001) {
    pet.setConsecutiveLosses(0);
  }

  // Volume → evolution (always adds, win or lose)
  if (volume > 0) {
    pet.addVolume(volume);
  }

  const { evolved, newStage } = checkEvolution(pet.stage, pet.cumulative_volume);
  if (evolved) {
    pet.setStage(newStage);
    pet.setJustEvolved(true);
    pet.setSpeechBubble('I EVOLVED!', 10000);
    db.saveEvent('evolution', JSON.stringify({
      from: pet.stage,
      to: newStage,
      volume: pet.cumulative_volume,
    }));
  }

  // PnL → happiness (mood)
  const happiness = pnl > 0
    ? Math.min(100, pet.vitals.happiness + 15)
    : Math.max(0, pet.vitals.happiness - 10);
  pet.setVitals({ happiness });

  // Feed the pet (hunger — manual mode)
  if (pet.mode === 'manual') {
    const newHunger = feedPet(pet.vitals.hunger, pnl);
    pet.setVitals({ hunger: newHunger });
  }

  // Track for mood engine
  lastPnlForPet = pnl;
  lastPnlWasRecent = true;
  pet.setLastTradeTime(Date.now());

  db.saveEvent('trade_completed', JSON.stringify({ pnl, volume }));
}

export function revivePet(): void {
  const pet = usePetStore.getState();
  const previousStage = pet.stage;
  const previousVolume = pet.cumulative_volume;

  pet.setIsAlive(true);
  pet.setVitals({ hunger: 50, happiness: 30, energy: 50, health: 50 });
  pet.setConsecutiveLosses(0);
  pet.setCumulativeVolume(0);
  pet.setStage('EGG');
  pet.setMood('content');
  pet.setSpeechBubble("I'm back... starting over.", 5000);
  db.saveEvent('revive', JSON.stringify({
    previous_stage: previousStage,
    lost_volume: previousVolume,
  }));
}
