/**
 * Server-side TreadTools client — direct HTTP, no proxy.
 */
import { TREADTOOLS_MIN_SCORE, TREADTOOLS_CACHE_TTL_MS, MIN_VOLUME } from '@/lib/constants';
import type { MarketSuitability, PairRanking, TreadtoolsSnapshot } from '@/lib/types';

const TREADTOOLS_BASE = 'https://treadtools.vercel.app/api';

const _cacheMap = new Map<string, { snapshot: TreadtoolsSnapshot; time: number }>();

const ELIGIBLE_STATUSES = ['great', 'good'];

async function fetchExchange(endpoint: string): Promise<MarketSuitability[]> {
  try {
    const res = await fetch(`${TREADTOOLS_BASE}/${endpoint}`, {
      signal: AbortSignal.timeout(15_000),
    });
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
  } catch (err) {
    console.warn('[TreadTools] fetchExchange failed:', err);
    return [];
  }
}

async function fetchRankings(): Promise<Record<string, PairRanking[]>> {
  try {
    const res = await fetch(`${TREADTOOLS_BASE}/rankings-data`, {
      signal: AbortSignal.timeout(15_000),
    });
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
  } catch (err) {
    console.warn('[TreadTools] fetchRankings failed:', err);
    return {};
  }
}

function getExchangeEndpoint(accountName: string): string {
  const name = accountName.toLowerCase();
  if (name.includes('paradex')) return 'paradex';
  if (name.includes('bybit')) return 'bybit';
  if (name.includes('hyperliquid') || name.includes('hl')) return 'hyperliquid';
  return 'paradex';
}

export async function getSnapshot(accountName = 'Paradex'): Promise<TreadtoolsSnapshot | null> {
  const now = Date.now();
  const exchange = getExchangeEndpoint(accountName);
  const cached = _cacheMap.get(exchange);
  if (cached && (now - cached.time) < TREADTOOLS_CACHE_TTL_MS) return cached.snapshot;

  try {
    const [marketData, rankings] = await Promise.all([
      fetchExchange(exchange),
      fetchRankings(),
    ]);

    const calm_pairs = [
      ...new Set(
        marketData
          .filter((m) => ELIGIBLE_STATUSES.includes(m.status) && m.score >= TREADTOOLS_MIN_SCORE)
          .map((m) => m.symbol),
      ),
    ];

    const snapshot: TreadtoolsSnapshot = {
      timestamp: new Date().toISOString(),
      hyperliquid_markets: exchange === 'hyperliquid' ? marketData : [],
      paradex_markets: exchange === 'paradex' ? marketData : [],
      all_markets: marketData,
      rankings,
      calm_pairs,
    };

    _cacheMap.set(exchange, { snapshot, time: now });
    return snapshot;
  } catch {
    return cached?.snapshot ?? null;
  }
}

export function toContextString(snapshot: TreadtoolsSnapshot | null): string {
  if (!snapshot) return 'Treadtools data unavailable. HOLD.';

  const lines: string[] = [];
  const markets = snapshot.all_markets;

  const tagged = markets.filter(
    (m) => ELIGIBLE_STATUSES.includes(m.status) && m.score >= TREADTOOLS_MIN_SCORE,
  );
  const tradeable = tagged.filter((m) => m.volume >= MIN_VOLUME);
  const lowVol = tagged.filter((m) => m.volume < MIN_VOLUME);

  if (tradeable.length) {
    lines.push('### ELIGIBLE PAIRS (score >= 70, calm/steady, vol >= $10M)');
    lines.push('| Symbol | Score | Status | Stability | OI/BBO | Volume | Suggested Mode |');
    lines.push('|--------|-------|--------|-----------|--------|--------|----------------|');
    tradeable
      .sort((a, b) => b.score - a.score)
      .forEach((m) => {
        let mode: string;
        if (m.oi_bbo >= 3000 && m.stability_mins >= 10) mode = 'grid/rgrid (-1 to +5 bps)';
        else if (m.oi_bbo >= 2000) mode = 'grid/rgrid (+3-5 bps) or mid';
        else if (m.oi_bbo < 1000) mode = 'mid (+5-10 bps)';
        else mode = 'mid (+5 bps) or grid/rgrid';
        lines.push(
          `| **${m.symbol}** | **${m.score}** | ${m.status} | ${m.stability_mins.toFixed(0)} min | ${m.oi_bbo.toFixed(0)} | $${(m.volume / 1e6).toFixed(1)}M | ${mode} |`,
        );
      });
    lines.push(`\n${tradeable.length} pair(s) eligible.`);
  } else if (!tagged.length) {
    lines.push('### ELIGIBLE PAIRS');
    lines.push(`**NONE.** No pairs with score >= ${TREADTOOLS_MIN_SCORE} and calm/steady status. HOLD.`);
  } else {
    lines.push('### ELIGIBLE PAIRS');
    lines.push('**NONE with sufficient volume.** You MUST hold.');
  }

  if (lowVol.length) {
    lines.push('\n### LOW VOLUME (< $10M) — eligible by score but insufficient volume');
    lowVol.forEach((m) => {
      lines.push(`- ${m.symbol}: score ${m.score}, ${m.status}, vol $${(m.volume / 1e6).toFixed(1)}M`);
    });
  }

  const ranks = snapshot.rankings.last_30_days || [];
  const topRanks = ranks.slice(0, 10);
  if (topRanks.length) {
    lines.push('\n### TOP PERFORMING (30d)');
    lines.push('| Symbol | Exchange | Strategy | Gross PnL | Volume |');
    lines.push('|--------|----------|----------|-----------|--------|');
    topRanks.forEach((r) => {
      lines.push(`| ${r.symbol} | ${r.exchange} | ${r.strategy} | $${r.gross_pnl.toFixed(2)} | $${r.volume.toLocaleString()} |`);
    });
  }

  return lines.join('\n');
}
