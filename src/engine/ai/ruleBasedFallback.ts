/**
 * Rule-based fallback — used when Claude API is unavailable.
 * Picks highest-score eligible pair and applies tier-based params.
 */
import { TREADTOOLS_MIN_SCORE, MIN_VOLUME } from '@/lib/constants';
import type { AIDecision, TreadtoolsSnapshot, RiskMetrics } from '@/lib/types';

export function getRuleBasedDecision(
  snapshot: TreadtoolsSnapshot | null,
  metrics: RiskMetrics,
  equity: number,
): AIDecision {
  if (!snapshot || !metrics.can_trade) {
    return { action: 'hold', reasoning: snapshot ? metrics.risk_message : 'No market data available.' };
  }

  // Find best eligible pair
  const eligible = snapshot.hyperliquid_markets
    .filter((m) => m.status === 'great' && m.score >= TREADTOOLS_MIN_SCORE && m.volume >= MIN_VOLUME)
    .sort((a, b) => b.score - a.score);

  if (!eligible.length) {
    return { action: 'hold', reasoning: `No calm pairs with score >= ${TREADTOOLS_MIN_SCORE} and volume >= $20M.` };
  }

  const best = eligible[0];
  let symbol = best.symbol.toUpperCase().replace('/USD', '-USD');
  if (!symbol.endsWith('-USD')) symbol = `${symbol}-USD`;

  // Tier-based params from prompt logic
  let leverage: number;
  let marginPct: number;
  let spreadBps: number;
  let referencePrice: string;
  let duration: number;
  let passiveness: number;

  if (best.score >= 90 && best.oi_bbo > 5000) {
    leverage = 35;
    marginPct = 0.18;
    spreadBps = 0;
    referencePrice = 'grid';
    duration = 3600;
    passiveness = 0.04;
  } else if (best.score >= 80 && best.oi_bbo >= 2000) {
    leverage = 20;
    marginPct = 0.14;
    spreadBps = 3;
    referencePrice = best.oi_bbo >= 3000 ? 'grid' : 'mid';
    duration = 3600;
    passiveness = 0.1;
  } else {
    leverage = 10;
    marginPct = 0.10;
    spreadBps = 5;
    referencePrice = 'mid';
    duration = best.stability_mins >= 10 ? 1800 : 900;
    passiveness = 0.1;
  }

  const margin = Math.round(equity * marginPct * 100) / 100;

  return {
    action: 'market_make',
    pair: symbol,
    margin,
    leverage,
    duration,
    spread_bps: spreadBps,
    reference_price: referencePrice,
    engine_passiveness: passiveness,
    schedule_discretion: 0.05,
    alpha_tilt: 0,
    grid_take_profit_pct: referencePrice === 'grid' ? 5 : undefined,
    confidence: 'medium',
    reasoning: `Rule-based: ${symbol} score=${best.score} oi_bbo=${best.oi_bbo.toFixed(0)} vol=$${(best.volume / 1e6).toFixed(1)}M → ${referencePrice} ${spreadBps}bps ${leverage}x`,
  };
}
