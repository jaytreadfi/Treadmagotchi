/**
 * PairSelector — picks tradeable pairs from TreadTools snapshot.
 * Uses the exchange-specific data matching the account we're trading on.
 * Accepts "great" (CALM) and "good" (STEADY) statuses.
 */
import { TREADTOOLS_MIN_SCORE, TREADTOOLS_MAX_DYNAMIC_PAIRS, MIN_VOLUME, FALLBACK_PAIRS } from '@/lib/constants';
import type { TreadtoolsSnapshot } from '@/lib/types';

const ELIGIBLE_STATUSES = ['great', 'good'];

export function getActivePairs(snapshot: TreadtoolsSnapshot | null): string[] {
  if (!snapshot) return FALLBACK_PAIRS;

  const eligible: string[] = [];
  for (const m of snapshot.all_markets) {
    if (ELIGIBLE_STATUSES.includes(m.status) && m.score >= TREADTOOLS_MIN_SCORE && m.volume >= MIN_VOLUME) {
      let symbol = m.symbol.toUpperCase().replace('/USD', '-USD');
      if (!symbol.endsWith('-USD')) symbol = `${symbol}-USD`;
      eligible.push(symbol);
    }
  }

  const limited = eligible.slice(0, TREADTOOLS_MAX_DYNAMIC_PAIRS);

  if (!limited.length) {
    return FALLBACK_PAIRS;
  }

  return limited;
}
