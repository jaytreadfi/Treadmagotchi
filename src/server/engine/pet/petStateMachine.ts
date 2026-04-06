/**
 * Server-side PetStateMachine -- orchestrates vitals, mood, evolution, and hunger.
 *
 * Key differences from client version:
 * - All state via repository.getPetState() / updatePetState() (SQLite)
 * - `just_evolved` boolean + setTimeout replaced by `evolved_at` timestamp
 * - Speech bubbles are SSE-only payloads (not persisted to DB)
 * - Emits `pet_updated` SSE event on meaningful state changes
 * - No zustand, no browser APIs
 */
import * as repository from '@/server/db/repository';
import * as configStore from '@/server/db/configStore';
import { sseEmitter } from '@/server/engine/sseEmitter';
import { dbCircuitBreaker } from '@/server/engine/dbCircuitBreaker';
import { deriveMood, type MoodContext } from '@/lib/pet/moodEngine';
import { checkEvolution } from '@/lib/pet/evolutionTracker';
import { applyOfflineDecay, feedPet } from '@/lib/pet/hungerSystem';
import { MOOD_SPEECHES } from '@/lib/constants';
import { pickRandomCharacter } from '@/lib/characters';
import type { PetMode, EvolutionStage } from '@/lib/types';

// ---------------------------------------------------------------------------
// In-memory ephemeral state (not persisted -- SSE-only or volatile)
// ---------------------------------------------------------------------------

let lastPnlForPet: number | null = null;
let lastPnlWasRecent = false;

/** How long (ms) the evolution animation should show. */
const EVOLVED_DISPLAY_MS = 8_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if pet recently evolved (within EVOLVED_DISPLAY_MS of evolved_at). */
function isJustEvolved(evolvedAt: number | null): boolean {
  if (!evolvedAt) return false;
  return Date.now() - evolvedAt < EVOLVED_DISPLAY_MS;
}

/** Emit a speech bubble via SSE (not persisted). */
function emitSpeechBubble(text: string, durationMs = 5000): void {
  sseEmitter.emit('pet_updated', {
    ...getCurrentPetSnapshot(),
    speech_bubble: text,
    speech_bubble_until: Date.now() + durationMs,
  });
}

/** Build a snapshot of the current pet state for SSE emission. */
function getCurrentPetSnapshot(): Record<string, unknown> {
  const pet = repository.getPetState();
  if (!pet) return {};
  const mode = configStore.getConfig<string>('mode') ?? 'auto';
  return {
    name: pet.name,
    mode,
    vitals: {
      hunger: pet.hunger,
      happiness: pet.happiness,
      energy: pet.energy,
      health: pet.health,
    },
    mood: pet.mood,
    stage: pet.stage,
    cumulative_volume: pet.cumulative_volume,
    consecutive_losses: pet.consecutive_losses,
    last_trade_time: pet.last_trade_time,
    last_save_time: pet.last_save_time,
    is_alive: pet.is_alive,
    just_evolved: isJustEvolved(pet.evolved_at ?? null),
    evolved_at: pet.evolved_at,
    egg_id: pet.egg_id,
    character_id: pet.character_id,
    // speech_bubble / speech_bubble_until are ephemeral, set by callers
    speech_bubble: null,
    speech_bubble_until: null,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize pet state on engine start.
 * Applies offline hunger/health decay based on elapsed time since last save.
 */
export function initPetState(): void {
  const pet = repository.getPetState();
  if (!pet) {
    // No pet row yet -- start as CRITTER with a character
    const characterId = pickRandomCharacter().id;
    repository.initPetState('Treadmagotchi', characterId);
    return;
  }

  // Backfill character_id for existing pets missing one
  if (!pet.character_id) {
    repository.updatePetState({
      character_id: pickRandomCharacter().id,
      stage: 'CRITTER',
    });
  } else if (pet.stage === 'EGG') {
    // Migrate any existing EGG pets to CRITTER
    repository.updatePetState({ stage: 'CRITTER' });
  }

  const elapsed = (Date.now() - pet.last_save_time) / 60000;

  if (elapsed > 1) {
    // Read the actual mode from config (auto/manual)
    const mode = (configStore.getConfig<string>('mode') ?? 'auto') as PetMode;

    const { hunger, health } = applyOfflineDecay(
      pet.hunger,
      pet.health,
      elapsed,
      mode,
    );

    const updates: Record<string, unknown> = {
      hunger,
      health,
      last_save_time: Date.now(),
    };

    if (health <= 0) {
      updates.is_alive = false;
      updates.mood = 'dead';
    }

    repository.updatePetState(updates);
  } else {
    repository.updatePetState({ last_save_time: Date.now() });
  }
}

/**
 * Called on a 10-second interval by the scheduler.
 * Updates mood based on current vitals and trading state.
 * Only emits SSE when mood or meaningful state changes.
 */
export function tickPetState(engineRunning: boolean): void {
  const pet = repository.getPetState();
  if (!pet) return;

  if (!pet.is_alive) {
    if (pet.mood !== 'dead') {
      repository.updatePetState({ mood: 'dead' });
      sseEmitter.emit('pet_updated', { ...getCurrentPetSnapshot(), mood: 'dead' });
    }
    return;
  }

  const justEvolved = isJustEvolved(pet.evolved_at ?? null);

  const mode = (configStore.getConfig<string>('mode') ?? 'auto') as PetMode;

  const ctx: MoodContext = {
    vitals: {
      hunger: pet.hunger,
      happiness: pet.happiness,
      energy: pet.energy,
      health: pet.health,
    },
    mode,
    isAlive: pet.is_alive,
    justEvolved,
    consecutiveLosses: pet.consecutive_losses,
    lastTradeTime: pet.last_trade_time,
    lastTradePnl: lastPnlForPet,
    lastTradeWasRecent: lastPnlWasRecent,
    engineRunning,
  };

  const newMood = deriveMood(ctx);
  const moodChanged = newMood !== pet.mood;

  if (moodChanged) {
    repository.updatePetState({ mood: newMood });

    // Pick a random speech for the new mood
    const speeches = MOOD_SPEECHES[newMood];
    if (speeches?.length) {
      const speech = speeches[Math.floor(Math.random() * speeches.length)];
      sseEmitter.emit('pet_updated', {
        ...getCurrentPetSnapshot(),
        mood: newMood,
        speech_bubble: speech,
        speech_bubble_until: Date.now() + 5000,
      });
    } else {
      sseEmitter.emit('pet_updated', { ...getCurrentPetSnapshot(), mood: newMood });
    }
  }

  // Decay lastPnlWasRecent after 10 minutes
  if (pet.last_trade_time && Date.now() - pet.last_trade_time > 10 * 60000) {
    lastPnlWasRecent = false;
  }

  // Silently persist last_save_time (no SSE for routine saves)
  // This is the most frequent DB write (every 10s) -- use it as
  // the circuit breaker canary for overall SQLite health.
  try {
    repository.updatePetState({ last_save_time: Date.now() });
    dbCircuitBreaker.recordSuccess();
  } catch (err) {
    dbCircuitBreaker.recordFailure(err);
  }
}

/**
 * Called when a bot completes. Volume drives evolution, PnL drives mood.
 * @param pnl -- realized PnL from the completed bot
 * @param volume -- total filled volume (both sides) from the completed bot
 */
export function onTradeCompleted(pnl: number, volume: number): void {
  const pet = repository.getPetState();
  if (!pet || !pet.is_alive) return;

  // PnL -> consecutive losses (mood)
  const newConsecutiveLosses = pnl < -0.001
    ? pet.consecutive_losses + 1
    : pnl > 0.001
      ? 0
      : pet.consecutive_losses;

  // Volume -> evolution (always adds, win or lose)
  const newVolume = volume > 0
    ? pet.cumulative_volume + volume
    : pet.cumulative_volume;

  const { evolved, newStage } = checkEvolution(
    pet.stage as EvolutionStage,
    newVolume,
  );

  // PnL -> happiness (mood)
  const happiness = pnl > 0
    ? Math.min(100, pet.happiness + 15)
    : Math.max(0, pet.happiness - 10);

  // Feed the pet (hunger -- manual mode)
  const mode = (configStore.getConfig<string>('mode') ?? 'auto') as PetMode;
  const newHunger = mode === 'manual'
    ? feedPet(pet.hunger, pnl)
    : pet.hunger;

  // Build update object
  const updates: Record<string, unknown> = {
    consecutive_losses: newConsecutiveLosses,
    cumulative_volume: newVolume,
    happiness,
    hunger: newHunger,
    last_trade_time: Date.now(),
    last_save_time: Date.now(),
  };

  if (evolved) {
    updates.stage = newStage;
    updates.evolved_at = Date.now();

    repository.saveEvent('evolution', JSON.stringify({
      from: pet.stage,
      to: newStage,
      volume: newVolume,
    }));
  }

  repository.updatePetState(updates);

  // Track for mood engine (in-memory, ephemeral)
  lastPnlForPet = pnl;
  lastPnlWasRecent = true;

  repository.saveEvent('trade_completed', JSON.stringify({ pnl, volume }));

  // Emit SSE events (trade_completed is emitted by executor.ts -- not here)
  if (evolved) {
    emitSpeechBubble('I EVOLVED!', 10000);
    sseEmitter.emit('evolution', { from: pet.stage, to: newStage, volume: newVolume });
  } else {
    // Emit pet_updated for happiness/consecutive_losses changes
    sseEmitter.emit('pet_updated', getCurrentPetSnapshot());
  }
}

/**
 * Revive a dead pet -- resets all stats.
 */
export function revivePet(): void {
  const pet = repository.getPetState();
  if (!pet) return;

  const previousStage = pet.stage;
  const previousVolume = pet.cumulative_volume;

  repository.updatePetState({
    is_alive: true,
    hunger: 50,
    happiness: 30,
    energy: 50,
    health: 50,
    consecutive_losses: 0,
    cumulative_volume: 0,
    stage: 'CRITTER',
    mood: 'content',
    evolved_at: null,
    last_save_time: Date.now(),
    character_id: pickRandomCharacter().id,
  });

  repository.saveEvent('revive', JSON.stringify({
    previous_stage: previousStage,
    lost_volume: previousVolume,
  }));

  emitSpeechBubble("I'm back... starting over.", 5000);
}

/**
 * Reroll the pet's appearance — new character sprite.
 */
export function rerollPet(): void {
  const pet = repository.getPetState();
  if (!pet || !pet.is_alive) return;

  const updates: Record<string, unknown> = {};

  let newCharId: string;
  do {
    newCharId = pickRandomCharacter().id;
  } while (newCharId === pet.character_id);
  updates.character_id = newCharId;

  repository.updatePetState(updates);
  repository.saveEvent('reroll', JSON.stringify({
    stage: pet.stage,
    ...updates,
  }));

  emitSpeechBubble('New look!');
}

/**
 * Get the current pet state snapshot for SSE hydration.
 */
export function getPetSnapshot(): Record<string, unknown> {
  return getCurrentPetSnapshot();
}
