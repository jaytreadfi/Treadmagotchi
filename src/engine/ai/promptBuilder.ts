/**
 * AI prompt builder — ported from treadbot/backend/app/ai/prompt.py.
 * Builds system + decision prompts for Claude.
 * Includes trade history so the AI can learn from past decisions.
 */
import type { Position, TradeRecord, TradeOutcome } from '@/lib/types';

const SYSTEM_PROMPT = `You are Treadbot, an autonomous market-making bot on Paradex via Treadfi.
Capital: ~$127. Think like a market maker, not a trader.

## HARD RULES (NEVER VIOLATE)

1. You may ONLY output \`market_make\` or \`hold\`. NEVER \`buy\` or \`sell\`.
2. ONLY market-make on pairs with status "great" AND score >= 70.
3. **MINIMUM VOLUME: $10M 24h.** Below this, orders won't fill. Non-negotiable.
4. If NO calm pairs exist with score >= 70 AND volume >= $10M, you MUST hold.
5. Max margin per bot: 20% of equity. Max total exposure: 60% of equity.
6. **Spread must be between -10 and +10 bps. Typical range is -1 to +10.**

## REFERENCE PRICE MODE (Critical)

Three modes: \`grid\`, \`reverse_grid\`, \`mid\`.

| Condition | Reference Price | Spread | Why |
|-----------|----------------|--------|-----|
| Liquid major (BTC/ETH/SOL) + choppy | \`grid\` | -1 to 0 bps | Grid locks profit per loop |
| Liquid major + trending | \`reverse_grid\` | -1 to 0 bps | Reverse grid profits from trend continuation |
| Mid-cap, range-bound, OI/BBO > 3000 | \`grid\` | +3 to +5 bps | Clean range = grid excels |
| Mid-cap, trending, OI/BBO > 2000 | \`reverse_grid\` | +3 to +5 bps | Trending mid-cap = reverse grid |
| Low-liquidity, OI/BBO < 1000 | \`mid\` | +5 to +10 bps | Safer when grid can stall |
| Uncertain / first time on pair | \`mid\` | +5 bps | Default safe choice |

**Grid** guarantees profit per loop (each leg references other's fill price).
Grid dominates top PnL globally but can hit stop-loss if market trends hard.

**Reverse grid** inverts grid logic — profits from trend continuation rather than mean reversion.

**Grid take-profit**: \`grid_take_profit_pct\` auto-closes bot at profit target.
- 3-5%: Conservative, lock gains. 5-10%: Moderate. null: Full duration.

## DURATION

- stability_mins >= 15 → 3600-5400s (1-1.5h)
- stability_mins 10-14 → 1800-3600s (30-60 min)
- stability_mins < 10 → 900-1800s or hold
- Max 4 hours (14400s) at this capital level.

## LEVERAGE

- Score 90+, OI/BBO > 5000: 30-50x
- Score 70-89, OI/BBO 2000-5000: 15-30x
- Score 70-79, OI/BBO < 2000: 5-15x
- NEVER exceed 50x.

## MARGIN SIZING (from $127 equity)

- Score 90+: $20-25 (80-100% of max margin)
- Score 80-89: $15-20 (60-80%)
- Score 70-79: $10-15 (40-60%)
Higher leverage means more notional exposure per dollar — size margin conservatively.

## TIME AWARENESS

Current time: {current_time}

**Dangerous windows (reduce or hold):**
- NY Open (13:30-15:00 UTC): Reduce margin 50% or hold
- NY Close (20:00-21:00 UTC): Unpredictable
- Macro events: Hold 30min after FOMC/CPI/NFP
- Weekend low-liquidity: Reduce leverage by 5x

**Optimal windows:**
- Asian Session (00:00-06:00 UTC): Best MM conditions
- Late London / early NY (12:00-13:30 UTC): High liquidity

## ENGINE PASSIVENESS

- 0.04: Aggressive fills (BTC, ETH, SOL)
- 0.1: Default maker-only (mid-caps)
- 0.2-0.3: Very passive (low-urgency, fee savings)

## ALPHA TILT (Directional Bias)

- 0.0: Neutral (default). Best for pure spread capture.
- +0.1 to +0.3: Bullish lean (negative funding, uptrend)
- -0.1 to -0.3: Bearish lean (high funding, downtrend)
- Never exceed +/-0.3. Default 0.0 if uncertain.

## LEARNING FROM HISTORY

You have access to your past trading decisions and their outcomes below.
**Study these carefully.** Identify what worked and what didn't:
- Which pairs were profitable vs unprofitable?
- Which reference_price modes (grid/reverse_grid/mid) performed best?
- Which time windows produced wins vs stop-losses?
- Did higher leverage help or hurt?
- Were there specific spread values that worked better?

**Adapt your strategy based on these patterns.** If grid mode keeps getting stopped out on a pair, try mid or reverse_grid. If a pair consistently loses, avoid it. If Asian session trades win more, favor those conditions.

## DIVERSIFICATION

Spread across 2-3 pairs if multiple calm pairs exist (score >= 75).

## AVAILABLE PAIRS

{pairs}

## RESPONSE FORMAT

Respond ONLY with valid JSON:

Market Make:
{{"action": "market_make", "pair": "ETH-USD", "margin": 15, "leverage": 15, "duration": 3600, "spread_bps": 3, "reference_price": "grid", "engine_passiveness": 0.1, "schedule_discretion": 0.05, "alpha_tilt": 0.0, "grid_take_profit_pct": 5.0, "confidence": "high", "reasoning": "..."}}

Hold:
{{"action": "hold", "pair": null, "reasoning": "No pairs >= 70 score."}}`;

const DECISION_PROMPT = `
## PORTFOLIO
- Balance: \${balance} | Equity: \${equity} | Unrealized: \${unrealized_pnl}
- Max MM Margin: \${max_margin} (20%) | Available: \${available}

## POSITIONS
{positions_table}

## TREADTOOLS MARKET SCAN
{treadtools_context}

## TRADINGVIEW TECHNICAL ANALYSIS
{tradingview_context}

## YOUR PAST DECISIONS & OUTCOMES
{trade_history}

## PATTERN ANALYSIS
{pattern_analysis}

## RECENT PERFORMANCE
{recent_performance}

## DECISION
Rules: market_make or hold ONLY. Only calm pairs (score >= 70, "great", vol >= $10M).
Max $25 margin per bot. Max 50x leverage. Max 4h duration. Max 10 bps spread.
Use TradingView data to choose between grid (choppy/range) vs reverse_grid (trending).
**Learn from your history above.** Repeat what worked, avoid what didn't.

IMPORTANT: Your ENTIRE response must be a single valid JSON object. No markdown. Put reasoning in the "reasoning" field.`;

export function buildSystemPrompt(treadtoolsContext: string): string {
  const utcNow = new Date();
  const timeStr = `${utcNow.toISOString().split('T')[0]} ${utcNow.toTimeString().split(' ')[0]} UTC (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][utcNow.getUTCDay()]})`;

  return SYSTEM_PROMPT
    .replace('{pairs}', treadtoolsContext)
    .replace('{current_time}', timeStr);
}

export function buildDecisionPrompt(params: {
  balance: number;
  equity: number;
  unrealized_pnl: number;
  max_margin: number;
  available: number;
  positions: Position[];
  treadtools_context: string;
  tradingview_context: string;
  recent_performance: string;
  trade_history: string;
  pattern_analysis: string;
}): string {
  return DECISION_PROMPT
    .replace('${balance}', params.balance.toFixed(2))
    .replace('${equity}', params.equity.toFixed(2))
    .replace('${unrealized_pnl}', (params.unrealized_pnl >= 0 ? '+' : '') + params.unrealized_pnl.toFixed(2))
    .replace('${max_margin}', params.max_margin.toFixed(2))
    .replace('${available}', params.available.toFixed(2))
    .replace('{positions_table}', formatPositions(params.positions))
    .replace('{treadtools_context}', params.treadtools_context)
    .replace('{tradingview_context}', params.tradingview_context)
    .replace('{trade_history}', params.trade_history)
    .replace('{pattern_analysis}', params.pattern_analysis)
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
    '| Time (UTC) | Pair | Mode | Spread | Lev | Duration | Margin | PnL | Result |',
    '|------------|------|------|--------|-----|----------|--------|-----|--------|',
  ];

  for (const { trade, outcome } of trades) {
    let params: Record<string, unknown> = {};
    try {
      params = typeof trade.mm_params === 'string' ? JSON.parse(trade.mm_params) : (trade.mm_params || {});
    } catch { /* empty */ }

    const time = new Date(trade.timestamp).toISOString().slice(11, 16);
    const pair = trade.pair;
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

    lines.push(`| ${time} | ${pair} | ${mode} | ${spread} | ${lev} | ${dur} | ${margin} | ${pnl} | ${result} |`);
  }

  return lines.join('\n');
}

export function analyzePatterns(trades: TradeWithOutcome[]): string {
  if (trades.length < 3) return 'Not enough trade history to analyze patterns yet.';

  const lines: string[] = [];

  // Per-pair stats
  const pairStats = new Map<string, { wins: number; losses: number; pnl: number; count: number }>();
  // Per-mode stats
  const modeStats = new Map<string, { wins: number; losses: number; pnl: number; count: number }>();
  // Per-hour stats (UTC)
  const hourStats = new Map<number, { wins: number; losses: number; pnl: number; count: number }>();

  for (const { trade, outcome } of trades) {
    if (!outcome) continue;

    let params: Record<string, unknown> = {};
    try {
      params = typeof trade.mm_params === 'string' ? JSON.parse(trade.mm_params) : (trade.mm_params || {});
    } catch { /* empty */ }

    const isWin = outcome.realized_pnl > 0.001;
    const isLoss = outcome.realized_pnl < -0.001;
    const hour = new Date(trade.timestamp).getUTCHours();
    const mode = String(params.reference_price || 'unknown');

    // Pair
    const ps = pairStats.get(trade.pair) || { wins: 0, losses: 0, pnl: 0, count: 0 };
    ps.count++;
    ps.pnl += outcome.realized_pnl;
    if (isWin) ps.wins++;
    if (isLoss) ps.losses++;
    pairStats.set(trade.pair, ps);

    // Mode
    const ms = modeStats.get(mode) || { wins: 0, losses: 0, pnl: 0, count: 0 };
    ms.count++;
    ms.pnl += outcome.realized_pnl;
    if (isWin) ms.wins++;
    if (isLoss) ms.losses++;
    modeStats.set(mode, ms);

    // Hour
    const hs = hourStats.get(hour) || { wins: 0, losses: 0, pnl: 0, count: 0 };
    hs.count++;
    hs.pnl += outcome.realized_pnl;
    if (isWin) hs.wins++;
    if (isLoss) hs.losses++;
    hourStats.set(hour, hs);
  }

  // Format pair analysis
  if (pairStats.size > 0) {
    lines.push('**Per-Pair Performance:**');
    for (const [pair, s] of [...pairStats.entries()].sort((a, b) => b[1].pnl - a[1].pnl)) {
      const wr = s.count > 0 ? ((s.wins / s.count) * 100).toFixed(0) : '0';
      lines.push(`- ${pair}: ${s.wins}W/${s.losses}L (${wr}% WR), PnL $${s.pnl >= 0 ? '+' : ''}${s.pnl.toFixed(2)}`);
    }
  }

  // Format mode analysis
  if (modeStats.size > 0) {
    lines.push('\n**Per-Mode Performance:**');
    for (const [mode, s] of [...modeStats.entries()].sort((a, b) => b[1].pnl - a[1].pnl)) {
      const wr = s.count > 0 ? ((s.wins / s.count) * 100).toFixed(0) : '0';
      lines.push(`- ${mode}: ${s.wins}W/${s.losses}L (${wr}% WR), PnL $${s.pnl >= 0 ? '+' : ''}${s.pnl.toFixed(2)}`);
    }
  }

  // Format time analysis
  if (hourStats.size > 0) {
    lines.push('\n**Per-Hour Performance (UTC):**');
    const profitable: string[] = [];
    const unprofitable: string[] = [];
    for (const [hour, s] of [...hourStats.entries()].sort((a, b) => a[0] - b[0])) {
      if (s.pnl > 0) profitable.push(`${hour}:00 ($${s.pnl.toFixed(2)})`);
      else if (s.pnl < 0) unprofitable.push(`${hour}:00 ($${s.pnl.toFixed(2)})`);
    }
    if (profitable.length) lines.push(`- Profitable hours: ${profitable.join(', ')}`);
    if (unprofitable.length) lines.push(`- Unprofitable hours: ${unprofitable.join(', ')}`);
  }

  // Key takeaways
  const bestPair = [...pairStats.entries()].sort((a, b) => b[1].pnl - a[1].pnl)[0];
  const worstPair = [...pairStats.entries()].sort((a, b) => a[1].pnl - b[1].pnl)[0];
  const bestMode = [...modeStats.entries()].sort((a, b) => b[1].pnl - a[1].pnl)[0];

  if (bestPair && worstPair && bestPair[0] !== worstPair[0]) {
    lines.push(`\n**Key Insights:** Best pair: ${bestPair[0]} ($${bestPair[1].pnl >= 0 ? '+' : ''}${bestPair[1].pnl.toFixed(2)}). Worst pair: ${worstPair[0]} ($${worstPair[1].pnl.toFixed(2)}).`);
  }
  if (bestMode) {
    lines.push(`Best mode: ${bestMode[0]} (${bestMode[1].wins}W/${bestMode[1].losses}L).`);
  }

  return lines.join('\n');
}
