/**
 * Server-side TradingView client — direct HTTP to scanner API, no proxy.
 */

const TV_SCANNER_URL = 'https://scanner.tradingview.com/crypto/scan';

const SYMBOL_MAP: Record<string, string> = {
  BTC: 'BINANCE:BTCUSDT.P',
  ETH: 'BINANCE:ETHUSDT.P',
  SOL: 'BINANCE:SOLUSDT.P',
  DOGE: 'BINANCE:DOGEUSDT.P',
  AVAX: 'BINANCE:AVAXUSDT.P',
  LINK: 'BINANCE:LINKUSDT.P',
  ARB: 'BINANCE:ARBUSDT.P',
  OP: 'BINANCE:OPUSDT.P',
  SUI: 'BINANCE:SUIUSDT.P',
  WIF: 'BINANCE:WIFUSDT.P',
  PEPE: 'BINANCE:PEPEUSDT.P',
  PAXG: 'BINANCE:PAXGUSDT.P',
  TIA: 'BINANCE:TIAUSDT.P',
  SEI: 'BINANCE:SEIUSDT.P',
  INJ: 'BINANCE:INJUSDT.P',
  FET: 'BINANCE:FETUSDT.P',
  ONDO: 'BINANCE:ONDOUSDT.P',
  AAVE: 'BINANCE:AAVEUSDT.P',
  NEAR: 'BINANCE:NEARUSDT.P',
  RENDER: 'BINANCE:RENDERUSDT.P',
  HYPE: 'BINANCE:HYPEUSDT.P',
  XRP: 'BINANCE:XRPUSDT.P',
  ADA: 'BINANCE:ADAUSDT.P',
  TRX: 'BINANCE:TRXUSDT.P',
  BNB: 'BINANCE:BNBUSDT.P',
};

function resolveSymbol(pair: string): string {
  const base = pair.toUpperCase().replace('-USD', '').replace('-USDT', '').replace('/USD', '');
  return SYMBOL_MAP[base] || `BINANCE:${base}USDT.P`;
}

export interface TVAnalysis {
  symbol: string;
  recommendation: string;
  buy: number;
  sell: number;
  neutral: number;
  rsi: number | null;
  macd_signal: number | null;
  ema_20: number | null;
  sma_50: number | null;
  adx: number | null;
  close: number | null;
  change_pct: number | null;
  volume_24h: number | null;
}

const COLUMNS = [
  'Recommend.All',
  'Recommend.All|1',
  'RSI',
  'MACD.signal',
  'EMA20',
  'SMA50',
  'ADX',
  'close',
  'change',
  'volume',
  'Recommend.MA',
  'Recommend.Other',
];

function scoreToRecommendation(score: number): string {
  if (score >= 0.5) return 'STRONG_BUY';
  if (score >= 0.1) return 'BUY';
  if (score > -0.1) return 'NEUTRAL';
  if (score > -0.5) return 'SELL';
  return 'STRONG_SELL';
}

export async function getAnalysis(pairs: string[]): Promise<Record<string, TVAnalysis>> {
  const tvSymbols = pairs.map((p) => resolveSymbol(p));

  const payload = {
    symbols: { tickers: tvSymbols },
    columns: COLUMNS,
  };

  try {
    const res = await fetch(TV_SCANNER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return {};
    const data = await res.json();

    const results: Record<string, TVAnalysis> = {};

    for (let i = 0; i < (data.data || []).length; i++) {
      const row = data.data[i];
      const values = row.d || [];
      const pair = pairs[i] || tvSymbols[i];

      const recScore = Number(values[0] || 0);
      const total = 26;
      const buyCount = Math.round(((recScore + 1) / 2) * total);
      const sellCount = Math.round(((1 - recScore) / 2) * total * 0.5);
      const neutralCount = total - buyCount - sellCount;

      results[pair] = {
        symbol: pair,
        recommendation: scoreToRecommendation(recScore),
        buy: Math.max(0, buyCount),
        sell: Math.max(0, sellCount),
        neutral: Math.max(0, neutralCount),
        rsi: values[2] != null ? Number(values[2]) : null,
        macd_signal: values[3] != null ? Number(values[3]) : null,
        ema_20: values[4] != null ? Number(values[4]) : null,
        sma_50: values[5] != null ? Number(values[5]) : null,
        adx: values[6] != null ? Number(values[6]) : null,
        close: values[7] != null ? Number(values[7]) : null,
        change_pct: values[8] != null ? Number(values[8]) : null,
        volume_24h: values[9] != null ? Number(values[9]) : null,
      };
    }

    return results;
  } catch {
    return {};
  }
}

export function toContextString(analyses: Record<string, TVAnalysis>): string {
  const entries = Object.entries(analyses);
  if (!entries.length) return 'TradingView data unavailable.';

  const lines = [
    '| Symbol | Signal | Buy/Sell/Neut | RSI | ADX | Price | Chg% | Trend |',
    '|--------|--------|---------------|-----|-----|-------|------|-------|',
  ];

  for (const [symbol, d] of entries) {
    const rsi = d.rsi != null ? d.rsi.toFixed(1) : 'N/A';
    const adx = d.adx != null ? d.adx.toFixed(1) : 'N/A';
    const price = d.close != null ? `$${d.close.toFixed(2)}` : 'N/A';
    const chg = d.change_pct != null ? `${d.change_pct >= 0 ? '+' : ''}${d.change_pct.toFixed(2)}%` : 'N/A';

    let trend = 'N/A';
    if (d.ema_20 != null && d.sma_50 != null) {
      trend = d.ema_20 > d.sma_50 ? 'Bullish' : 'Bearish';
    }

    lines.push(
      `| ${symbol} | **${d.recommendation}** | ${d.buy}/${d.sell}/${d.neutral} | ${rsi} | ${adx} | ${price} | ${chg} | ${trend} |`,
    );
  }

  return lines.join('\n');
}
