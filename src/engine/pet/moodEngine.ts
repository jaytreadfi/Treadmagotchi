/**
 * MoodEngine — derives mood from vitals + recent trading events.
 * Priority-ordered: critical states > event-driven > vitals-based.
 */
import type { PetVitals, PetMood, PetMode } from '@/lib/types';

export interface MoodContext {
  vitals: PetVitals;
  mode: PetMode;
  isAlive: boolean;
  justEvolved: boolean;
  consecutiveLosses: number;
  lastTradeTime: number | null;
  lastTradePnl: number | null;
  lastTradeWasRecent: boolean; // within last 10 minutes
  engineRunning: boolean;
}

export function deriveMood(ctx: MoodContext): PetMood {
  // 1. Critical states (highest priority)
  if (!ctx.isAlive || ctx.vitals.health <= 0) return 'dead';
  if (ctx.mode === 'manual' && ctx.vitals.hunger <= 0) return 'starving';
  if (ctx.vitals.health < 30) return 'sick';
  if (ctx.mode === 'manual' && ctx.vitals.hunger < 30) return 'hungry';

  // 2. Event-driven (recent trading events)
  if (ctx.justEvolved) return 'proud';

  if (ctx.lastTradeWasRecent && ctx.lastTradePnl != null) {
    if (ctx.lastTradePnl > 1) return 'excited'; // big win
    if (ctx.consecutiveLosses >= 3) return 'angry';
    if (ctx.lastTradePnl < 0 && ctx.consecutiveLosses >= 1) return 'sad';
    if (ctx.lastTradePnl < 0 && ctx.consecutiveLosses === 0) return 'determined';
  }

  if (ctx.consecutiveLosses >= 3) return 'angry';

  // 3. Vitals-based
  if (ctx.vitals.energy < 20) return 'sleeping';

  // Bored: auto mode, no trades for 30+ minutes
  if (ctx.mode === 'auto' && ctx.engineRunning) {
    const noTradeMinutes = ctx.lastTradeTime
      ? (Date.now() - ctx.lastTradeTime) / 60000
      : 999;
    if (noTradeMinutes >= 30) return 'bored';
  }

  if (ctx.vitals.happiness > 80) return 'happy';

  return 'content';
}
