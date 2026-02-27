import type { EvolutionStage } from './types';

// ── Risk limits (ported identically from Treadbot config.py) ──
export const MAX_POSITION_PCT = 0.40;
export const MAX_TOTAL_EXPOSURE_PCT = 0.60;
export const MAX_DAILY_LOSS_USD = 10.0;   // Absolute floor
export const MAX_DAILY_LOSS_PCT = 0.05;   // 5% of equity — used when equity-based limit > $10
export const MAX_DRAWDOWN_PCT = 0.15;
export const STOP_LOSS_PCT = 0.10;
export const MAX_LEVERAGE = 50;
export const MAX_SPREAD_BPS = 10;
export const MAX_MM_DURATION = 14400;
export const MIN_VOLUME = 10_000_000;

// ── Trading intervals (ms) ──
export const DECISION_INTERVAL_MS = 5 * 60 * 1000;     // 5 min
export const BOT_SYNC_INTERVAL_MS = 30 * 1000;          // 30s
export const EQUITY_SNAPSHOT_INTERVAL_MS = 60 * 1000;    // 60s
export const MARKET_DATA_INTERVAL_MS = 2 * 60 * 1000;    // 2 min

// ── Treadtools ──
export const TREADTOOLS_MIN_SCORE = 70;
export const TREADTOOLS_CACHE_TTL_MS = 120 * 1000;
export const TREADTOOLS_MAX_DYNAMIC_PAIRS = 8;

// ── Pet vitals ──
export const HUNGER_DECAY_PER_MIN = 0.5;
export const MAX_STARVATION_DAMAGE_MINS = 120;
export const PET_SAVE_INTERVAL_MS = 30 * 1000;

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

// ── Proxy base ──
export const PROXY_BASE = '/api/proxy';

// ── Claude ──
export const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

// ── Canvas ──
export const CANVAS_LOGICAL_SIZE = 160;
export const CANVAS_DISPLAY_SIZE = 320;

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
