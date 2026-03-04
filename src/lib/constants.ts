import type { EvolutionStage } from './types';

// ── Risk limits ──
export const MAX_POSITION_PCT = 0.80;
export const MAX_TOTAL_EXPOSURE_PCT = 0.80;
export const MAX_DAILY_LOSS_USD = 20.0;   // Absolute floor
export const MAX_DAILY_LOSS_PCT = 0.10;   // 10% of equity
export const MAX_DRAWDOWN_PCT = 0.30;
export const STOP_LOSS_PCT = 0.10;
export const MAX_LEVERAGE = 50;
export const MAX_SPREAD_BPS = 10;
export const MAX_MM_DURATION = 14400;
export const MIN_VOLUME = 10_000_000;
export const MAX_BOTS_PER_CYCLE = 3;
export const MAX_CONCURRENT_BOTS = 8;

// ── Order monitor thresholds ──
export const ORDER_MONITOR_START_MS = 5 * 60 * 1000;      // 5 min — no monitoring before this
export const ORDER_SPREAD_ADJUST_MS = 15 * 60 * 1000;     // 15 min — set spread to 0 if drifted
export const ORDER_CANCEL_MS = 30 * 60 * 1000;            // 30 min — cancel if barely filled
export const ORDER_DRIFT_THRESHOLD_PCT = 0.005;            // 0.5% price drift
export const ORDER_MIN_FILL_PCT = 20;                      // cancel if <20% filled at 30 min

// ── Trading intervals (ms) ──
export const BOT_SYNC_INTERVAL_MS = 30 * 1000;          // 30s

// ── Treadtools ──
export const TREADTOOLS_MIN_SCORE = 70;
export const TREADTOOLS_CACHE_TTL_MS = 120 * 1000;
export const TREADTOOLS_MAX_DYNAMIC_PAIRS = 8;

// ── Pet vitals ──
export const HUNGER_DECAY_PER_MIN = 0.5;
export const MAX_STARVATION_DAMAGE_MINS = 120;

// ── Evolution thresholds (cumulative trading volume in USD) ──
export const EVOLUTION_THRESHOLDS: Record<EvolutionStage, number> = {
  EGG: 0,
  CRITTER: 100_000,
  CREATURE: 1_000_000,
  BEAST: 5_000_000,
  MYTHIC: 55_555_555,
};

export const EVOLUTION_ORDER: EvolutionStage[] = [
  'EGG', 'CRITTER', 'CREATURE', 'BEAST', 'MYTHIC',
];

// ── Fallback pairs ──
export const FALLBACK_PAIRS = ['BTC-USD', 'ETH-USD', 'SOL-USD'];

// ── Treadfi pair conversion ──
const USDT_EXCHANGES = new Set(['okxdex', 'aster', 'bybit']);

export function pairToTreadfi(pair: string, exchange?: string): string {
  const base = pair.replace('-USD', '').replace('-USDT', '').trim();
  const quote = exchange && USDT_EXCHANGES.has(exchange.toLowerCase()) ? 'USDT' : 'USDC';
  return `${base}:PERP-${quote}`;
}

export function treadfiToPair(treadfiPair: string): string {
  const base = treadfiPair.split(':')[0].split('-')[0].trim();
  return `${base}-USD`;
}

// ── WAF User-Agent ──
export const WAF_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ── Claude ──
export const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

// ── Canvas ──
export const CANVAS_LOGICAL_SIZE = 160;

// ── Sprites & Animation ──
export const EGG_COUNT = 59;
export const CHARACTER_FRAME_SIZE = 24;
export const WALK_SPEED = 0.4;
export const WALK_ANIM_FPS = 8;
export const IDLE_MIN_FRAMES = 180;  // ~3 sec at 60fps
export const IDLE_MAX_FRAMES = 480;  // ~8 sec at 60fps
export const SIT_MIN_FRAMES = 240;   // ~4 sec at 60fps
export const SIT_MAX_FRAMES = 600;   // ~10 sec at 60fps
export const HAPPY_BURST_FRAMES = 90; // ~1.5 sec at 60fps
export const WALK_BOUNDS_MIN = 36;   // matches clearing area
export const WALK_BOUNDS_MAX = 124;  // matches clearing area

// ── Mood speech bubbles ──
export const MOOD_SPEECHES: Record<string, string[]> = {
  dead: ['...'],
  starving: ["I'm so hungry...", 'Feed me...', 'Please...'],
  sick: ["I don't feel good...", 'Need rest...'],
  hungry: ['Got any food?', 'A little hungry...'],
  proud: ['Look at me!', 'I evolved!', 'AMAZING!'],
  excited: ['Big win!', 'YES!', 'To the moon!'],
  angry: ['Ugh, stop loss...', 'Not fair!', 'Grr...'],
  sad: ['Losing streak...', 'Why...', '*sigh*'],
  determined: ['I can do this!', 'Bouncing back!', 'Watch me!'],
  sleeping: ['zzz...', 'Zzz...', '...zzZ'],
  bored: ['Hello?', 'Any trades?', '*yawn*'],
  happy: ['Life is good!', 'Making money!', 'Woohoo!'],
  content: ['All good.', 'Steady...', 'Chill vibes.'],
};
