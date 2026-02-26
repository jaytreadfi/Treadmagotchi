/**
 * PairSelector — ported from treadbot/backend/app/trading/pairs.py.
 * Picks tradeable pairs from TreadTools snapshot.
 */
import { TREADTOOLS_MIN_SCORE, TREADTOOLS_MAX_DYNAMIC_PAIRS, MIN_VOLUME, FALLBACK_PAIRS } from '@/lib/constants';
import type { TreadtoolsSnapshot } from '@/lib/types';

export function getActivePairs(snapshot: TreadtoolsSnapshot | null): string[] {
  if (!snapshot) return FALLBACK_PAIRS;

  const eligible: string[] = [];
  for (const m of snapshot.hyperliquid_markets) {
    if (m.status === 'great' && m.score >= TREADTOOLS_MIN_SCORE && m.volume >= MIN_VOLUME) {
      let symbol = m.symbol.toUpperCase().replace('/USD', '-USD');
      if (!symbol.endsWith('-USD')) symbol = `${symbol}-USD`;
      eligible.push(symbol);
    }
  }

  const limited = eligible.slice(0, TREADTOOLS_MAX_DYNAMIC_PAIRS);

  if (!limited.length) {
    // Still need price data even if holding
    return FALLBACK_PAIRS;
  }

  return limited;
}
