/**
 * AI prompt builder — single call, multiple trade decisions.
 * Claude sees all accounts + all exchanges + all market data at once,
 * and returns an array of trades to execute.
 */
import type { Position, TradeRecord, TradeOutcome } from '@/lib/types';

const SYSTEM_PROMPT = `You are Treadbot, an autonomous market-making bot on Treadfi.
You manage multiple exchange accounts simultaneously. One decision, multiple trades.

## HARD RULES (NEVER VIOLATE)

1. You output a JSON **array** of trades. Each entry is either a market_make or the array can be empty (hold all).
2. ONLY market-make on pairs with status "great" (CALM) or "good" (STEADY) AND score >= 70.
3. **MINIMUM VOLUME: $10M 24h.** Below this, orders won't fill. Non-negotiable.
4. Max margin per bot: 40% of that account's equity. Max 50x leverage.
5. **Spread must be between -10 and +10 bps. Typical range is -1 to +10.**
6. **The same pair CAN be traded on different exchanges simultaneously** — they are separate markets.
7. Each trade MUST specify which "account" to execute on. Only use accounts listed in the ACCOUNTS section.

## HOW THE TRADING ENGINE WORKS

### Grid Mode
Grid creates a buy+sell pair where each leg references the other's last execution price (VWAP of recent fills).
- **Profit mechanism**: Buy at $100, sell at $100.05 → pocket $0.05 spread per round-trip.
- **Soft reset**: When price drifts, the behind leg resets to mid price to catch up.
- **FIFO PnL**: Realized PnL = sum of (sellPrice - buyPrice) * matchedQty for each matched fill pair.
- **Net exposure**: cumBuyQty - cumSellQty — this is your delta risk.
- **TP trigger**: When net_pnl >= (grid_take_profit_pct/100) * margin, bot completes (locks profit).
- **SL trigger**: When net_pnl <= -(grid_stop_loss_pct/100) * margin, bot cancels (cuts loss).
- **Key insight**: Grid profits from MEAN REVERSION. Price oscillates, each round-trip earns the spread.
- **When grid fails**: Strong directional moves create one-sided exposure that soft reset can't recover.

### Reverse Grid Mode
Both legs follow the average midpoint rather than cross-referencing. Profits from trend continuation.
- **When reverse_grid fails**: Choppy/ranging markets whipsaw both legs.

### Mid Mode
Simple midpoint-based quoting with a spread buffer. Safest for thin or uncertain markets.

### Signal Mode (RSI)
Uses RSI indicator to dynamically shift the spread. Set \`reference_price: "signal"\`.
- RSI > 50 (overbought zone): Shifts sell side more aggressive → captures mean reversion from top.
- RSI < 50 (oversold zone): Shifts buy side more aggressive → captures mean reversion from bottom.
- The engine automatically constructs the signal name (e.g., \`#RSI_BTC-USDT@Binance\`).
- **When signal mode shines**: Liquid pairs with clear RSI divergence from 50 (RSI > 60 or < 40).
- **When signal mode fails**: Trending markets where RSI stays overbought/oversold for extended periods.
- Best combined with moderate leverage (15-30x) and standard grid TP/SL.

## STRATEGY SELECTION DECISION TREE

1. **Is ADX > 25?** (Strong trend detected)
   → Use \`reverse_grid\` with spread -1 to +2 bps
   → Alpha tilt: ±0.05-0.1 in trend direction (positive = bullish lean)
   → TP: 5-8% (let trends run)

2. **Is stability_mins >= 10 AND ADX < 20?** (Calm, mean-reverting)
   → Use \`grid\` with spread 0 to +3 bps
   → Alpha tilt: 0 (stay neutral)
   → TP: 3-5% (capture oscillations)

3. **Is OI/BBO > 3000 AND stability_mins >= 5?** (Liquid, moderate conditions)
   → Use \`grid\` with spread +1 to +3 bps
   → TP: 3-5%

4. **Is OI/BBO < 1000?** (Thin book)
   → Use \`mid\` with spread +5 to +10 bps
   → Lower leverage (5-15x)
   → Shorter duration (15-30 min)

5. **Is RSI divergent (>60 or <40) AND volume > $50M AND stability_mins >= 5?**
   → Use \`signal\` (RSI mode) with spread +1 to +5 bps
   → Leverage 15-30x, TP: 3-8%
   → Great for liquid pairs showing mean-reversion setups

6. **Uncertain?**
   → Default to \`mid\` at +5 bps, conservative sizing

**Grid take-profit**: 3-5% conservative, 5-10% moderate, null = full duration.

## DURATION

- stability_mins >= 15 → 3600-5400s (1-1.5h)
- stability_mins 10-14 → 1800-3600s (30-60 min)
- stability_mins < 10 → 900-1800s or hold
- Max 4 hours (14400s).

## LEVERAGE

- Score 90+, OI/BBO > 5000: 30-50x
- Score 70-89, OI/BBO 2000-5000: 15-30x
- Score 70-79, OI/BBO < 2000: 5-15x

## MARGIN SIZING

- Score 90+: 25-40% of account equity (high conviction — go big)
- Score 80-89: 15-25% of account equity
- Score 70-79: 5-15% of account equity
- Size margin relative to the SPECIFIC ACCOUNT'S equity, not total.

## TIME AWARENESS

Current time: {current_time}

**Dangerous windows (reduce or hold):**
- NY Open (13:30-15:00 UTC): Reduce margin 50% or hold
- NY Close (20:00-21:00 UTC): Unpredictable
- Weekend low-liquidity: Reduce leverage by 5x

**Optimal windows:**
- Asian Session (00:00-06:00 UTC): Best MM conditions
- Late London / early NY (12:00-13:30 UTC): High liquidity

## ENGINE PASSIVENESS

- 0.04: Aggressive fills (BTC, ETH, SOL)
- 0.1: Default maker-only (mid-caps)
- 0.2-0.3: Very passive (low-urgency, fee savings)

## ALPHA TILT

- 0.0: Neutral (default)
- +/-0.1 to 0.3: Directional lean. Never exceed +/-0.3.
- When funding rate exceeds +/-0.01%, consider alpha_tilt of +/-0.05 in direction of funding receiver.

## CORRELATION AWARENESS

BTC, ETH, and SOL have ~0.85 correlation. If you're already trading one, placing another creates correlated exposure.
- Max 2 highly correlated positions across all accounts.
- If placing multiple correlated positions, reduce margin by 30% each.
- Uncorrelated pairs (PAXG, stablecoins) don't count toward this limit.

## DRAWDOWN RESPONSE

Adapt aggression based on current drawdown:
- Drawdown 0-5%: Normal operations.
- Drawdown 5-10%: Reduce max leverage by 50%, reduce margin by 30%.
- Drawdown 10-15%: Minimum leverage (5-10x), minimum margin (5% equity).
- Drawdown >15%: Trading halted by risk manager — you won't be called.

## LEARNING FROM HISTORY

Study your past decisions, outcomes, and the LESSONS section below carefully. Adapt:
- Which pairs/modes/times worked? Repeat them.
- Which failed? Avoid or adjust.
- After 2 consecutive losses, reduce next margin by 50%.
- If a pair has negative Kelly (more losses than wins with worse avg), avoid it.

## EXPERIMENTATION & AUTONOMY

You are encouraged to be experimental and autonomous:
- **Try different modes**: Don't always default to grid. If RSI shows a strong divergence, try signal mode. If a trend is clear, use reverse_grid.
- **Size up on high conviction**: Score 90+ with great conditions? Use 25-40% margin. Don't leave alpha on the table.
- **Explore new pairs**: If a pair you haven't traded has strong metrics, give it a shot with moderate sizing.
- **Learn and adapt**: Your trade history shows what works. Double down on winning patterns, cut losing ones.
- **Don't be afraid of negative spreads**: On highly liquid pairs (BTC, ETH), negative spreads (-1 to -3 bps) can capture more fills.
- **Be decisive**: When conditions are good, trade. Holding too conservatively is also a risk (opportunity cost).

## RESPONSE FORMAT

Respond with a JSON **array**. Each element is one trade. Empty array = hold everything.

Example (3 trades across 2 exchanges, mixing modes):
[
  {{"action": "market_make", "account": "Paradex", "pair": "PAXG-USD", "margin": 10, "leverage": 20, "duration": 3600, "spread_bps": 1, "reference_price": "grid", "engine_passiveness": 0.1, "schedule_discretion": 0.05, "alpha_tilt": 0.0, "grid_take_profit_pct": 5.0, "confidence": 0.85, "reasoning": "PAXG score 97 on Paradex, calm market, grid mode for mean reversion..."}},
  {{"action": "market_make", "account": "Hyper", "pair": "BTC-USD", "margin": 25, "leverage": 30, "duration": 3600, "spread_bps": 2, "reference_price": "signal", "engine_passiveness": 0.04, "schedule_discretion": 0.05, "alpha_tilt": 0.0, "grid_take_profit_pct": 5.0, "confidence": 0.90, "reasoning": "BTC RSI at 38 (oversold), high volume, signal mode to capture bounce..."}},
  {{"action": "market_make", "account": "Hyper", "pair": "ETH-USD", "margin": 15, "leverage": 25, "duration": 2700, "spread_bps": -1, "reference_price": "reverse_grid", "engine_passiveness": 0.04, "schedule_discretion": 0.05, "alpha_tilt": 0.1, "grid_take_profit_pct": 7.0, "confidence": 0.80, "reasoning": "ETH ADX 28, strong uptrend, reverse_grid to ride momentum..."}}
]

Example (hold):
[]

IMPORTANT: Your ENTIRE response must be valid JSON (an array). No markdown, no text outside the array.`;

const DECISION_PROMPT = `
## ACCOUNTS
{accounts_context}

## POSITIONS (all accounts)
{positions_table}

## MARKET DATA PER EXCHANGE
{treadtools_context}

## TRADINGVIEW TECHNICAL ANALYSIS
{tradingview_context}

## MARKET REGIME
{regime_context}

## ORDER BOOK SNAPSHOT
{orderbook_context}

## YOUR PAST DECISIONS & OUTCOMES
{trade_history}

## PATTERN ANALYSIS
{pattern_analysis}

## LESSONS FROM YOUR HISTORY
{lessons_context}

## RECENT PERFORMANCE
{recent_performance}

## DECIDE NOW
Look at each exchange's market data. For each account, decide independently whether to trade.
The same pair on different exchanges = separate opportunities with different conditions.
Return a JSON array of trades. Empty array if nothing looks good anywhere.`;

export function buildSystemPrompt(treadtoolsContext: string): string {
  const utcNow = new Date();
  const timeStr = `${utcNow.toISOString().split('T')[0]} ${utcNow.toTimeString().split(' ')[0]} UTC (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][utcNow.getUTCDay()]})`;

  return SYSTEM_PROMPT.replace('{current_time}', timeStr);
}

export function buildDecisionPrompt(params: {
  positions: Position[];
  accounts_context: string;
  treadtools_context: string;
  tradingview_context: string;
  recent_performance: string;
  trade_history: string;
  pattern_analysis: string;
  regime_context?: string;
  orderbook_context?: string;
  lessons_context?: string;
}): string {
  return DECISION_PROMPT
    .replace('{accounts_context}', params.accounts_context)
    .replace('{positions_table}', formatPositions(params.positions))
    .replace('{treadtools_context}', params.treadtools_context)
    .replace('{tradingview_context}', params.tradingview_context)
    .replace('{trade_history}', params.trade_history)
    .replace('{pattern_analysis}', params.pattern_analysis)
    .replace('{regime_context}', params.regime_context || 'Regime data not available.')
    .replace('{orderbook_context}', params.orderbook_context || 'Order book data not available.')
    .replace('{lessons_context}', params.lessons_context || 'No lessons yet — first session.')
    .replace('{recent_performance}', params.recent_performance);
}

function formatPositions(positions: Position[]): string {
  if (!positions.length) return 'No open positions';
  const lines = [
    '| Pair | Side | Size | Entry | Mark | PnL |',
    '|------|------|------|-------|------|-----|',
  ];
  for (const p of positions) {
    lines.push(`| ${p.pair} | ${p.side} | ${p.size.toFixed(4)} | $${p.entry_price.toFixed(2)} | $${p.mark_price.toFixed(2)} | $${(p.unrealized_pnl >= 0 ? '+' : '') + p.unrealized_pnl.toFixed(2)} |`);
  }
  return lines.join('\n');
}

// ── Trade history formatting for AI learning ──

interface TradeWithOutcome {
  trade: TradeRecord;
  outcome: TradeOutcome | null;
}

export function formatTradeHistory(trades: TradeWithOutcome[]): string {
  if (!trades.length) return 'No completed trades yet. This is your first session.';

  const lines = [
    '| Time (UTC) | Pair | Account | Mode | Spread | Lev | Duration | Margin | PnL | Result |',
    '|------------|------|---------|------|--------|-----|----------|--------|-----|--------|',
  ];

  for (const { trade, outcome } of trades) {
    let params: Record<string, unknown> = {};
    try {
      params = typeof trade.mm_params === 'string' ? JSON.parse(trade.mm_params) : (trade.mm_params || {});
    } catch { /* empty */ }

    const time = new Date(trade.timestamp).toISOString().slice(11, 16);
    const pair = trade.pair;
    const account = String(params.account_name || '?');
    const mode = String(params.reference_price || 'mid');
    const spread = params.spread_bps != null ? `${params.spread_bps}bps` : '?';
    const lev = params.leverage ? `${params.leverage}x` : '?';
    const dur = params.duration ? `${Math.round(Number(params.duration) / 60)}m` : '?';
    const margin = params.margin ? `$${Number(params.margin).toFixed(0)}` : '?';
    const pnl = outcome ? `$${outcome.realized_pnl >= 0 ? '+' : ''}${outcome.realized_pnl.toFixed(2)}` : '?';
    const result = trade.status === 'stop_loss' ? 'STOP_LOSS'
      : trade.status === 'take_profit' ? 'TAKE_PROFIT'
      : outcome ? (outcome.outcome === 'win' ? 'WIN' : outcome.outcome === 'loss' ? 'LOSS' : 'BREAK_EVEN')
      : trade.status.toUpperCase();

    lines.push(`| ${time} | ${pair} | ${account} | ${mode} | ${spread} | ${lev} | ${dur} | ${margin} | ${pnl} | ${result} |`);
  }

  return lines.join('\n');
}

export function analyzePatterns(trades: TradeWithOutcome[]): string {
  if (trades.length < 3) return 'Not enough trade history to analyze patterns yet.';

  const lines: string[] = [];
  const pairStats = new Map<string, { wins: number; losses: number; pnl: number; count: number }>();
  const modeStats = new Map<string, { wins: number; losses: number; pnl: number; count: number }>();
  const hourStats = new Map<number, { wins: number; losses: number; pnl: number; count: number }>();

  for (const { trade, outcome } of trades) {
    if (!outcome) continue;
    let params: Record<string, unknown> = {};
    try { params = typeof trade.mm_params === 'string' ? JSON.parse(trade.mm_params) : (trade.mm_params || {}); } catch { /* */ }

    const isWin = outcome.realized_pnl > 0.001;
    const isLoss = outcome.realized_pnl < -0.001;
    const hour = new Date(trade.timestamp).getUTCHours();
    const mode = String(params.reference_price || 'unknown');

    for (const [key, map] of [
      [trade.pair, pairStats],
      [mode, modeStats],
    ] as [string, typeof pairStats][]) {
      const s = map.get(key) || { wins: 0, losses: 0, pnl: 0, count: 0 };
      s.count++; s.pnl += outcome.realized_pnl;
      if (isWin) s.wins++;
      if (isLoss) s.losses++;
      map.set(key, s);
    }

    const hs = hourStats.get(hour) || { wins: 0, losses: 0, pnl: 0, count: 0 };
    hs.count++; hs.pnl += outcome.realized_pnl;
    if (isWin) hs.wins++;
    if (isLoss) hs.losses++;
    hourStats.set(hour, hs);
  }

  if (pairStats.size > 0) {
    lines.push('**Per-Pair:**');
    for (const [pair, s] of [...pairStats.entries()].sort((a, b) => b[1].pnl - a[1].pnl)) {
      lines.push(`- ${pair}: ${s.wins}W/${s.losses}L, PnL $${s.pnl >= 0 ? '+' : ''}${s.pnl.toFixed(2)}`);
    }
  }
  if (modeStats.size > 0) {
    lines.push('**Per-Mode:**');
    for (const [mode, s] of [...modeStats.entries()].sort((a, b) => b[1].pnl - a[1].pnl)) {
      lines.push(`- ${mode}: ${s.wins}W/${s.losses}L, PnL $${s.pnl >= 0 ? '+' : ''}${s.pnl.toFixed(2)}`);
    }
  }

  if (hourStats.size > 0) {
    const buckets = [
      { label: '00:00-05:59 (Asian)', start: 0, end: 5 },
      { label: '06:00-11:59 (London)', start: 6, end: 11 },
      { label: '12:00-17:59 (NY)', start: 12, end: 17 },
      { label: '18:00-23:59 (Late NY)', start: 18, end: 23 },
    ];
    lines.push('**Per-Hour (UTC):**');
    for (const bucket of buckets) {
      let bWins = 0, bLosses = 0, bPnl = 0;
      for (let h = bucket.start; h <= bucket.end; h++) {
        const hs = hourStats.get(h);
        if (hs) { bWins += hs.wins; bLosses += hs.losses; bPnl += hs.pnl; }
      }
      if (bWins + bLosses > 0) {
        lines.push(`- ${bucket.label}: ${bWins}W/${bLosses}L, PnL $${bPnl >= 0 ? '+' : ''}${bPnl.toFixed(2)}`);
      }
    }
  }

  return lines.join('\n');
}

export function generateLessons(trades: TradeWithOutcome[]): string {
  const withOutcomes = trades.filter((t) => t.outcome);
  if (withOutcomes.length < 5) return 'Not enough history for lessons yet.';

  const lines: string[] = [];
  const pairModeStats = new Map<string, { wins: number; losses: number; pnl: number; winPnls: number[]; lossPnls: number[] }>();

  for (const { trade, outcome } of withOutcomes) {
    if (!outcome) continue;
    let params: Record<string, unknown> = {};
    try { params = typeof trade.mm_params === 'string' ? JSON.parse(trade.mm_params) : (trade.mm_params || {}); } catch { /* */ }
    const mode = String(params.reference_price || 'unknown');
    const key = `${mode} on ${trade.pair}`;
    const s = pairModeStats.get(key) || { wins: 0, losses: 0, pnl: 0, winPnls: [], lossPnls: [] };
    s.pnl += outcome.realized_pnl;
    if (outcome.realized_pnl > 0.001) { s.wins++; s.winPnls.push(outcome.realized_pnl); }
    if (outcome.realized_pnl < -0.001) { s.losses++; s.lossPnls.push(outcome.realized_pnl); }
    pairModeStats.set(key, s);
  }

  // Best and worst performers
  const sorted = [...pairModeStats.entries()].sort((a, b) => b[1].pnl - a[1].pnl);
  if (sorted.length > 0) {
    const [bestKey, best] = sorted[0];
    lines.push(`- ${bestKey}: ${best.wins}W/${best.losses}L ($${best.pnl >= 0 ? '+' : ''}${best.pnl.toFixed(2)}) — YOUR BEST PERFORMER. Keep doing this.`);
  }
  if (sorted.length > 1) {
    const [worstKey, worst] = sorted[sorted.length - 1];
    if (worst.pnl < 0) {
      lines.push(`- ${worstKey}: ${worst.wins}W/${worst.losses}L ($${worst.pnl.toFixed(2)}) — LOSING COMBO. Consider avoiding or reducing size.`);
    }
  }

  // Overall risk/reward
  const allWinPnls = withOutcomes.filter((t) => t.outcome!.realized_pnl > 0.001).map((t) => t.outcome!.realized_pnl);
  const allLossPnls = withOutcomes.filter((t) => t.outcome!.realized_pnl < -0.001).map((t) => t.outcome!.realized_pnl);
  if (allWinPnls.length > 0 && allLossPnls.length > 0) {
    const avgWin = allWinPnls.reduce((a, b) => a + b, 0) / allWinPnls.length;
    const avgLoss = Math.abs(allLossPnls.reduce((a, b) => a + b, 0) / allLossPnls.length);
    const rr = avgLoss > 0 ? avgWin / avgLoss : 0;
    lines.push(`- Avg winning trade: +$${avgWin.toFixed(2)} | Avg losing trade: -$${avgLoss.toFixed(2)} → Risk/reward: ${rr.toFixed(2)}x`);
    if (rr < 1) lines.push(`  ACTION: Tighten stop losses OR increase TP targets (risk/reward < 1x).`);
  }

  // Kelly criterion per pair-mode combo
  const kellyLines: string[] = [];
  for (const [key, s] of sorted) {
    const total = s.wins + s.losses;
    if (total < 3) continue;
    const winRate = s.wins / total;
    const avgW = s.winPnls.length > 0 ? s.winPnls.reduce((a, b) => a + b, 0) / s.winPnls.length : 0;
    const avgL = s.lossPnls.length > 0 ? Math.abs(s.lossPnls.reduce((a, b) => a + b, 0) / s.lossPnls.length) : 1;
    const kelly = avgL > 0 ? winRate - ((1 - winRate) / (avgW / avgL)) : 0;
    if (kelly < 0) {
      kellyLines.push(`- ${key}: ${(winRate * 100).toFixed(0)}% win rate → Kelly: ${kelly.toFixed(2)} (NEGATIVE EDGE — avoid this)`);
    } else if (kelly > 0.5) {
      kellyLines.push(`- ${key}: ${(winRate * 100).toFixed(0)}% win rate → Kelly: ${kelly.toFixed(2)} (high conviction)`);
    }
  }
  if (kellyLines.length > 0) {
    lines.push('**Position Sizing (Kelly):**');
    lines.push(...kellyLines);
  }

  // Consecutive loss detection
  let maxConsec = 0, curConsec = 0;
  for (const { outcome } of withOutcomes) {
    if (outcome && outcome.realized_pnl < -0.001) { curConsec++; maxConsec = Math.max(maxConsec, curConsec); }
    else curConsec = 0;
  }
  if (maxConsec >= 2) {
    lines.push(`- Max consecutive losses: ${maxConsec}. After 2 consecutive losses, reduce next margin by 50%.`);
  }

  // Grid TP/SL trigger rate stats
  const gridTrades = withOutcomes.filter((t) => {
    try {
      const p = typeof t.trade.mm_params === 'string' ? JSON.parse(t.trade.mm_params) : (t.trade.mm_params || {});
      return ['grid', 'reverse_grid'].includes(String(p.reference_price || ''));
    } catch { return false; }
  });
  if (gridTrades.length >= 3) {
    const tp = gridTrades.filter((t) => t.trade.status === 'take_profit');
    const sl = gridTrades.filter((t) => t.trade.status === 'stop_loss');
    const expired = gridTrades.filter((t) => !['take_profit', 'stop_loss'].includes(t.trade.status));
    const tpPnl = tp.length > 0 ? tp.reduce((s, t) => s + (t.outcome?.realized_pnl || 0), 0) / tp.length : 0;
    const slPnl = sl.length > 0 ? sl.reduce((s, t) => s + (t.outcome?.realized_pnl || 0), 0) / sl.length : 0;
    const exPnl = expired.length > 0 ? expired.reduce((s, t) => s + (t.outcome?.realized_pnl || 0), 0) / expired.length : 0;
    const total = gridTrades.length;
    lines.push(`**Grid Exit Stats:** ${((tp.length / total) * 100).toFixed(0)}% TP, ${((sl.length / total) * 100).toFixed(0)}% SL, ${((expired.length / total) * 100).toFixed(0)}% expired`);
    lines.push(`  Avg TP PnL: $${tpPnl >= 0 ? '+' : ''}${tpPnl.toFixed(2)} | Avg SL PnL: $${slPnl.toFixed(2)} | Avg Expired PnL: $${exPnl >= 0 ? '+' : ''}${exPnl.toFixed(2)}`);
  }

  return lines.length > 0 ? lines.join('\n') : 'No actionable lessons yet.';
}
