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
4. Max margin per bot: 20% of that account's equity. Max 50x leverage.
5. **Spread must be between -10 and +10 bps. Typical range is -1 to +10.**
6. **The same pair CAN be traded on different exchanges simultaneously** — they are separate markets.
7. Each trade MUST specify which "account" to execute on. Only use accounts listed in the ACCOUNTS section.

## REFERENCE PRICE MODE

Three modes: \`grid\`, \`reverse_grid\`, \`mid\`.

| Condition | Reference Price | Spread | Why |
|-----------|----------------|--------|-----|
| Liquid major + choppy | \`grid\` | -1 to 0 bps | Grid locks profit per loop |
| Liquid major + trending | \`reverse_grid\` | -1 to 0 bps | Profits from trend continuation |
| Mid-cap, range-bound, OI/BBO > 3000 | \`grid\` | +3 to +5 bps | Clean range = grid excels |
| Mid-cap, trending, OI/BBO > 2000 | \`reverse_grid\` | +3 to +5 bps | Trending mid-cap |
| Low-liquidity, OI/BBO < 1000 | \`mid\` | +5 to +10 bps | Safer when grid can stall |
| Uncertain / first time on pair | \`mid\` | +5 bps | Default safe choice |

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

- Score 90+: 15-20% of account equity
- Score 80-89: 10-15% of account equity
- Score 70-79: 5-10% of account equity
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

## LEARNING FROM HISTORY

Study your past decisions and outcomes below. Adapt:
- Which pairs/modes/times worked? Repeat them.
- Which failed? Avoid or adjust.

## RESPONSE FORMAT

Respond with a JSON **array**. Each element is one trade. Empty array = hold everything.

Example (2 trades across 2 exchanges):
[
  {{"action": "market_make", "account": "Paradex", "pair": "PAXG-USD", "margin": 10, "leverage": 20, "duration": 3600, "spread_bps": 1, "reference_price": "grid", "engine_passiveness": 0.1, "schedule_discretion": 0.05, "alpha_tilt": 0.0, "grid_take_profit_pct": 5.0, "reasoning": "PAXG score 97 on Paradex..."}},
  {{"action": "market_make", "account": "Hyper", "pair": "PAXG-USD", "margin": 15, "leverage": 30, "duration": 3600, "spread_bps": 0, "reference_price": "grid", "engine_passiveness": 0.04, "schedule_discretion": 0.05, "alpha_tilt": 0.0, "grid_take_profit_pct": 5.0, "reasoning": "PAXG score 94 on Hyperliquid..."}}
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

## YOUR PAST DECISIONS & OUTCOMES
{trade_history}

## PATTERN ANALYSIS
{pattern_analysis}

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
}): string {
  return DECISION_PROMPT
    .replace('{accounts_context}', params.accounts_context)
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

  return lines.join('\n');
}
