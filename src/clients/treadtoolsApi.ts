/**
 * TreadTools client — ported from treadbot/backend/app/clients/treadtools.py.
 * Fetches market suitability scores and rankings via proxy.
 */
import { PROXY_BASE, TREADTOOLS_MIN_SCORE, TREADTOOLS_CACHE_TTL_MS, MIN_VOLUME } from '@/lib/constants';
import type { MarketSuitability, PairRanking, TreadtoolsSnapshot } from '@/lib/types';

let _cache: TreadtoolsSnapshot | null = null;
let _cacheTime = 0;

async function fetchExchange(endpoint: string): Promise<MarketSuitability[]> {
  try {
    const res = await fetch(`${PROXY_BASE}/treadtools?path=/api/${endpoint}`);
    if (!res.ok) return [];
    const data = await res.json();
    const items = Array.isArray(data) ? data : (data.data || []);
    if (!Array.isArray(items)) return [];

    return items.map((item: Record<string, unknown>) => ({
      symbol: String(item.symbol || item.coin || ''),
      score: Number(item.score || item.suitabilityScore || 0),
      stability_mins: Number(item.stabilityMins || item.stability_mins || 0),
      status: String(item.status || 'unknown'),
      oi_bbo: Number(item.oiBbo || item.oi_bbo || 0),
      volume: Number(item.volume || item.dailyVolume || 0),
    }));
  } catch {
    return [];
  }
}

async function fetchRankings(): Promise<Record<string, PairRanking[]>> {
  try {
    const res = await fetch(`${PROXY_BASE}/treadtools?path=/api/rankings-data`);
    if (!res.ok) return {};
    const data = await res.json();

    const rankings: Record<string, PairRanking[]> = {};
    for (const window of ['all_time', 'last_90_days', 'last_30_days']) {
      rankings[window] = ((data[window] || []) as Array<Record<string, unknown>>).map(
        (item, idx) => ({
          rank: idx + 1,
          exchange: String(item.exchange || ''),
          symbol: String(item.symbol || item.coin || ''),
          strategy: String(item.strategy || ''),
          gross_pnl: Number(item.grossPnl || item.gross_pnl || 0),
          volume: Number(item.volume || 0),
          count: Number(item.count || item.tradeCount || 0),
        }),
      );
    }
    return rankings;
  } catch {
    return {};
  }
}

export async function getSnapshot(): Promise<TreadtoolsSnapshot | null> {
  const now = Date.now();
  if (_cache && (now - _cacheTime) < TREADTOOLS_CACHE_TTL_MS) return _cache;

  try {
    const [hlData, rankings] = await Promise.all([
      fetchExchange('hyperliquid'),
      fetchRankings(),
    ]);

    const calm_pairs = [
      ...new Set(
        hlData
          .filter((m) => m.status === 'great' && m.score >= TREADTOOLS_MIN_SCORE)
          .map((m) => m.symbol),
      ),
    ];

    const snapshot: TreadtoolsSnapshot = {
      timestamp: new Date().toISOString(),
      hyperliquid_markets: hlData,
      rankings,
      calm_pairs,
    };

    _cache = snapshot;
    _cacheTime = now;
    return snapshot;
  } catch {
    return _cache;
  }
}

export function toContextString(snapshot: TreadtoolsSnapshot | null): string {
  if (!snapshot) return 'Treadtools data unavailable. HOLD.';

  const lines: string[] = [];
  const tagged = snapshot.hyperliquid_markets.filter(
    (m) => m.status === 'great' && m.score >= TREADTOOLS_MIN_SCORE,
  );
  const tradeable = tagged.filter((m) => m.volume >= MIN_VOLUME);
  const lowVol = tagged.filter((m) => m.volume < MIN_VOLUME);

  if (tradeable.length) {
    lines.push('### CALM PAIRS (Eligible for Market Making)');
    lines.push('| Symbol | Score | Stability | OI/BBO | Volume | Suggested Mode |');
    lines.push('|--------|-------|-----------|--------|--------|----------------|');
    tradeable
      .sort((a, b) => b.score - a.score)
      .forEach((m) => {
        let mode: string;
        if (m.oi_bbo >= 3000 && m.stability_mins >= 10) mode = 'grid/rgrid (-1 to +5 bps)';
        else if (m.oi_bbo >= 2000) mode = 'grid/rgrid (+3-5 bps) or mid';
        else if (m.oi_bbo < 1000) mode = 'mid (+5-10 bps)';
        else mode = 'mid (+5 bps) or grid/rgrid';
        lines.push(
          `| **${m.symbol}** | **${m.score}** | ${m.stability_mins.toFixed(0)} min | ${m.oi_bbo.toFixed(0)} | $${(m.volume / 1e6).toFixed(1)}M | ${mode} |`,
        );
      });
    lines.push(`\n${tradeable.length} pair(s) eligible.`);
  } else if (!tagged.length) {
    lines.push('### CALM PAIRS');
    lines.push(`**NONE.** No pairs with 'great' status and score >= ${TREADTOOLS_MIN_SCORE}. HOLD.`);
  } else {
    lines.push('### CALM PAIRS');
    lines.push('**NONE with sufficient volume.** You MUST hold.');
  }

  if (lowVol.length) {
    lines.push('\n### LOW VOLUME (< $10M)');
    lowVol.forEach((m) => {
      lines.push(`- ${m.symbol}: score ${m.score}, vol $${(m.volume / 1e6).toFixed(1)}M — TOO LOW`);
    });
  }

  const ranks = snapshot.rankings.last_30_days || [];
  const hlRanks = ranks.filter((r) =>
    ['hyperliquid', 'extended'].includes(r.exchange.toLowerCase()),
  ).slice(0, 10);
  if (hlRanks.length) {
    lines.push('\n### TOP PERFORMING (Hyperliquid, 30d)');
    lines.push('| Symbol | Strategy | Gross PnL | Volume |');
    lines.push('|--------|----------|-----------|--------|');
    hlRanks.forEach((r) => {
      lines.push(`| ${r.symbol} | ${r.strategy} | $${r.gross_pnl.toFixed(2)} | $${r.volume.toLocaleString()} |`);
    });
  }

  return lines.join('\n');
}
