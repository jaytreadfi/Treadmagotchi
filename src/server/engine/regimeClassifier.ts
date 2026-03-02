/**
 * Market regime classifier -- computes regime from TradingView indicators
 * and TreadTools suitability data.
 *
 * Server-side port: pure logic, no browser dependencies.
 */
import type { TVAnalysis } from '@/server/clients/tradingviewApi';
import type { MarketSuitability } from '@/lib/types';

export type Regime = 'TRENDING_UP' | 'TRENDING_DOWN' | 'RANGING' | 'VOLATILE' | 'CALM';

export interface RegimeResult {
  pair: string;
  regime: Regime;
  confidence: 'High' | 'Medium' | 'Low';
  recommended: string;
}

export function classifyRegime(pair: string, tv: TVAnalysis | undefined, tt: MarketSuitability | undefined): RegimeResult {
  const adx = tv?.adx ?? 0;
  const changePct = Math.abs(tv?.change_pct ?? 0);
  const stability = tt?.stability_mins ?? 0;
  const rsi = tv?.rsi ?? 50;
  const isBullish = tv?.ema_20 != null && tv?.sma_50 != null ? tv.ema_20 > tv.sma_50 : (tv?.change_pct ?? 0) > 0;

  // Strong trend: ADX > 25 or large price change
  if (adx > 25 || changePct > 2) {
    const regime = isBullish ? 'TRENDING_UP' as const : 'TRENDING_DOWN' as const;
    const confidence = adx > 30 ? 'High' as const : 'Medium' as const;
    return { pair, regime, confidence, recommended: 'reverse_grid, follow trend' };
  }

  // Calm and stable: ADX < 20 + good stability
  if (adx < 20 && stability >= 10) {
    return { pair, regime: 'CALM', confidence: 'High', recommended: 'grid, tight spread' };
  }

  // Ranging: moderate ADX with moderate stability
  if (adx < 25 && stability >= 5 && changePct < 1.5) {
    const confidence = stability >= 10 ? 'High' as const : 'Medium' as const;
    return { pair, regime: 'RANGING', confidence, recommended: 'grid, capture oscillations' };
  }

  // Volatile: low stability, choppy
  if (stability < 5 || (adx < 20 && changePct > 1)) {
    return { pair, regime: 'VOLATILE', confidence: rsi > 70 || rsi < 30 ? 'High' : 'Medium', recommended: 'mid, wide spread, short duration' };
  }

  // Default to ranging
  return { pair, regime: 'RANGING', confidence: 'Low', recommended: 'mid, conservative' };
}

export function regimeToContextString(regimes: RegimeResult[]): string {
  if (!regimes.length) return 'Regime data not available.';

  const lines = [
    '| Pair | Regime | Confidence | Recommended Strategy |',
    '|------|--------|------------|---------------------|',
  ];

  for (const r of regimes) {
    lines.push(`| ${r.pair} | ${r.regime} | ${r.confidence} | ${r.recommended} |`);
  }

  return lines.join('\n');
}
