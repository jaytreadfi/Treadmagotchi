/**
 * Trading engine — 5-minute core loop.
 * One Claude call per cycle. Returns array of trades across all exchanges.
 */
import * as treadApi from '@/clients/treadApi';
import { exchangeToTreadtools } from '@/clients/treadApi';
import { MAX_POSITION_PCT } from '@/lib/constants';
import * as treadtoolsApi from '@/clients/treadtoolsApi';
import * as tradingviewApi from '@/clients/tradingviewApi';
import { riskManager } from './riskManager';
import { getActivePairs } from './pairSelector';
import { classifyRegime, regimeToContextString } from './regimeClassifier';
import * as executor from './executor';
import { makeDecisions } from '@/engine/ai/decisionEngine';
import { useConfigStore } from '@/store/useConfigStore';
import { useTradingStore } from '@/store/useTradingStore';
import { usePetStore } from '@/store/usePetStore';
import { onTradeCompleted } from '@/engine/pet/petStateMachine';
import * as db from '@/persistence/db';
import type { AccountInfo, DecisionLogEntry } from '@/lib/types';

function log(msg: string, ...args: unknown[]) {
  console.log(`[TradingEngine] ${msg}`, ...args);
}

const lastKnownVolume = new Map<string, number>();

export async function runTradingLoop(): Promise<void> {
  const store = useTradingStore.getState();
  const enabledAccounts = useConfigStore.getState().accounts.filter((a) => a.enabled);
  log('=== Trading Loop Start ===');

  if (!enabledAccounts.length) {
    log('No enabled accounts, skipping');
    return;
  }

  try {
    // 1. Sync bot statuses
    const completed = await executor.syncBotStatuses();
    if (completed.length) {
      log('Completed bots:', completed);
      for (const c of completed) {
        if (c.pnl !== undefined) {
          onTradeCompleted(Number(c.pnl), Number(c.volume || 0));
        }
      }
    }

    // 2. Fetch TreadTools per unique exchange
    const exchanges = [...new Set(enabledAccounts.map((a) => a.exchange))];
    const treadtoolsLines: string[] = [];
    let lastSnapshot = null;
    let allActivePairs: string[] = [];

    for (const exchange of exchanges) {
      const ttEndpoint = exchangeToTreadtools(exchange);
      const accountsOnExchange = enabledAccounts.filter((a) => a.exchange === exchange).map((a) => a.name);
      log(`Fetching TreadTools for ${exchange}...`);
      const snapshot = await treadtoolsApi.getSnapshot(exchange);
      if (snapshot) {
        lastSnapshot = snapshot;
        treadtoolsLines.push(`### ${exchange} (accounts: ${accountsOnExchange.join(', ')})\n${treadtoolsApi.toContextString(snapshot)}`);
        const pairs = getActivePairs(snapshot);
        allActivePairs = [...new Set([...allActivePairs, ...pairs])];
        log(`  ${exchange}: ${snapshot.calm_pairs.length} eligible pairs`);
      }
    }

    const treadtoolsCtx = treadtoolsLines.length ? treadtoolsLines.join('\n\n') : 'No market data available. HOLD.';

    // 3. TradingView for all active pairs
    let tvContext = 'TradingView data unavailable.';
    let tvAnalyses: Record<string, Awaited<ReturnType<typeof tradingviewApi.getAnalysis>>[string]> = {};
    try {
      tvAnalyses = await tradingviewApi.getAnalysis(allActivePairs);
      if (Object.keys(tvAnalyses).length) {
        tvContext = tradingviewApi.toContextString(tvAnalyses);
        log(`TradingView: ${Object.keys(tvAnalyses).join(', ')}`);
      }
    } catch { /* non-fatal */ }

    // 3b. Regime classification
    const regimes = allActivePairs.map((pair) => {
      const tv = tvAnalyses[pair];
      const tt = lastSnapshot?.all_markets.find((m) => m.symbol === pair.replace('-USD', ''));
      return classifyRegime(pair, tv, tt);
    });
    const regimeCtx = regimeToContextString(regimes);
    log(`Regimes: ${regimes.map((r) => `${r.pair}=${r.regime}`).join(', ')}`);

    // 3c. Order book depth + imbalance
    let orderbookCtx = 'Order book data not available.';
    try {
      const obLines = [
        '| Pair | Bid Depth ($) | Ask Depth ($) | Imbalance | Spread (bps) |',
        '|------|--------------|--------------|-----------|-------------|',
      ];
      let hasData = false;
      for (const pair of allActivePairs.slice(0, 6)) {
        try {
          // Use first account name for order book API call
          const acctName = enabledAccounts[0]?.name || 'Paradex';
          const book = await treadApi.getOrderBook(pair, acctName);
          const bids = (book.bids || []) as Array<Record<string, unknown> | [number, number]>;
          const asks = (book.asks || []) as Array<Record<string, unknown> | [number, number]>;
          if (!bids.length || !asks.length) continue;

          let bidDepth = 0, askDepth = 0;
          const topN = 10; // top 10 levels
          for (let i = 0; i < Math.min(topN, bids.length); i++) {
            const b = bids[i];
            const price = Array.isArray(b) ? b[0] : Number((b as Record<string, unknown>).price || 0);
            const size = Array.isArray(b) ? b[1] : Number((b as Record<string, unknown>).size || (b as Record<string, unknown>).amount || 0);
            bidDepth += price * size;
          }
          for (let i = 0; i < Math.min(topN, asks.length); i++) {
            const a = asks[i];
            const price = Array.isArray(a) ? a[0] : Number((a as Record<string, unknown>).price || 0);
            const size = Array.isArray(a) ? a[1] : Number((a as Record<string, unknown>).size || (a as Record<string, unknown>).amount || 0);
            askDepth += price * size;
          }

          const total = bidDepth + askDepth;
          const imbalance = total > 0 ? (bidDepth - askDepth) / total : 0;
          const imbalanceLabel = imbalance > 0.05 ? `+${imbalance.toFixed(2)} (buy heavy)` : imbalance < -0.05 ? `${imbalance.toFixed(2)} (sell heavy)` : `${imbalance.toFixed(2)} (balanced)`;

          // Calculate spread in bps
          const bestBid = Array.isArray(bids[0]) ? bids[0][0] : Number((bids[0] as Record<string, unknown>).price || 0);
          const bestAsk = Array.isArray(asks[0]) ? asks[0][0] : Number((asks[0] as Record<string, unknown>).price || 0);
          const mid = (bestBid + bestAsk) / 2;
          const spreadBps = mid > 0 ? ((bestAsk - bestBid) / mid) * 10000 : 0;

          obLines.push(`| ${pair} | $${(bidDepth / 1000).toFixed(1)}k | $${(askDepth / 1000).toFixed(1)}k | ${imbalanceLabel} | ${spreadBps.toFixed(1)} bps |`);
          hasData = true;
        } catch { /* skip pair */ }
      }
      if (hasData) orderbookCtx = obLines.join('\n');
    } catch { /* non-fatal */ }

    // 4. Fetch per-account balances + positions
    let totalEquity = 0;
    let totalUnrealizedPnl = 0;
    const allPositions: Awaited<ReturnType<typeof treadApi.getPositions>> = [];
    const accountInfoMap = new Map<string, AccountInfo>();
    const accountsCtxLines: string[] = [];

    const MIN_EQUITY_TO_TRADE = 5; // Skip accounts with less than $5 equity
    const tradableAccounts: typeof enabledAccounts = [];

    for (const acct of enabledAccounts) {
      try {
        const info = await treadApi.getAccountInfo(acct.name);
        const pos = await treadApi.getPositions(acct.name);

        if (info.equity < MIN_EQUITY_TO_TRADE) {
          log(`  ${acct.name}: eq=$${info.equity.toFixed(2)} — below $${MIN_EQUITY_TO_TRADE} threshold, skipping`);
          continue;
        }

        accountInfoMap.set(acct.name, info);
        tradableAccounts.push(acct);
        totalEquity += info.equity;
        totalUnrealizedPnl += info.unrealized_pnl;
        allPositions.push(...pos);
        accountsCtxLines.push(
          `- **${acct.name}** (${acct.exchange}): eq=$${info.equity.toFixed(2)} | max margin=$${(info.equity * MAX_POSITION_PCT).toFixed(2)} | ${pos.length} positions`,
        );
        log(`  ${acct.name}: eq=$${info.equity.toFixed(2)}`);
      } catch (e) {
        log(`  ${acct.name}: failed - ${e}`);
      }
    }

    if (!tradableAccounts.length) {
      log('No accounts with sufficient equity, skipping trading');
      return;
    }

    const aggregateAccount: AccountInfo = {
      balance: totalEquity - totalUnrealizedPnl,
      equity: totalEquity,
      unrealized_pnl: totalUnrealizedPnl,
      margin_used: 0,
    };
    store.setAccount(aggregateAccount);
    store.setPositions(allPositions);

    // 5. Global risk check
    const metrics = riskManager.calculateMetrics(aggregateAccount.balance, allPositions);
    store.setRiskMetrics(metrics);
    log(`Risk: dd=${(metrics.drawdown_pct * 100).toFixed(1)}% can_trade=${metrics.can_trade}`);

    if (!metrics.can_trade) {
      log(`Trading paused: ${metrics.risk_message}`);
      store.setLastDecisionTime(Date.now());
      return;
    }

    // 6. Build shared context
    const recentPerf = await buildPerformance(aggregateAccount.equity);
    const { tradeHistory, patternAnalysis, lessonsContext } = await buildTradeHistory();

    // 7. ONE Claude call → array of trades
    log('Requesting decisions (single call)...');
    const decisions = await makeDecisions({
      positions: allPositions,
      accountsContext: accountsCtxLines.join('\n'),
      treadtoolsContext: treadtoolsCtx,
      tradingviewContext: tvContext,
      recentPerformance: recentPerf,
      tradeHistory,
      patternAnalysis,
      regimeContext: regimeCtx,
      orderbookContext: orderbookCtx,
      lessonsContext,
      snapshot: lastSnapshot,
      metrics,
      totalEquity,
    });

    store.setLastDecisionTime(Date.now());

    if (!decisions.length) {
      log('Decision: HOLD (no trades)');
      store.addDecision({
        timestamp: new Date().toISOString(),
        action: 'hold',
        pair: null,
        reasoning: 'No opportunities across all exchanges.',
        active_pairs: allActivePairs,
        calm_pairs: lastSnapshot?.calm_pairs || [],
        portfolio: { balance: aggregateAccount.balance, equity: totalEquity, unrealized_pnl: totalUnrealizedPnl, exposure_pct: metrics.exposure_pct },
      });
    }

    // 8. Execute each trade (deduplicate: one pair per account)
    const executedPairAccounts = new Set<string>();
    for (const decision of decisions) {
      if (decision.action !== 'market_make' || !decision.pair || !decision.account) {
        log(`  Skipping invalid decision: ${JSON.stringify(decision).slice(0, 100)}`);
        continue;
      }

      // Validate account exists, is enabled, and has sufficient equity
      const acct = tradableAccounts.find((a) => a.name === decision.account);
      if (!acct) {
        log(`  Account "${decision.account}" not found, skipping`);
        continue;
      }

      // Deduplicate: only one bot per pair+account combo
      const dedupeKey = `${decision.pair}::${acct.name}`;
      if (executedPairAccounts.has(dedupeKey)) {
        log(`  Skipping duplicate: ${decision.pair} on ${acct.name} (already submitted)`);
        continue;
      }
      executedPairAccounts.add(dedupeKey);

      const accountEquity = accountInfoMap.get(acct.name)?.equity || 0;
      log(`  Executing: ${decision.pair} on ${acct.name} | margin=$${decision.margin} lev=${decision.leverage}x | ${decision.reasoning.slice(0, 80)}`);

      const result = await executor.executeMm(decision, accountEquity, acct.name, acct.exchange);
      log(result ? `  Bot launched: ${String(result.id || '').slice(0, 12)}` : '  Execution failed');

      store.addDecision({
        timestamp: new Date().toISOString(),
        action: 'market_make',
        pair: decision.pair,
        reasoning: `[${acct.name}] ${decision.reasoning}`,
        active_pairs: allActivePairs,
        calm_pairs: lastSnapshot?.calm_pairs || [],
        portfolio: { balance: aggregateAccount.balance, equity: totalEquity, unrealized_pnl: totalUnrealizedPnl, exposure_pct: metrics.exposure_pct },
      });
    }

    // 9. Save PnL snapshot
    await db.savePnlSnapshot({
      timestamp: Date.now(),
      balance: aggregateAccount.balance,
      equity: aggregateAccount.equity,
      unrealized_pnl: aggregateAccount.unrealized_pnl,
      num_positions: allPositions.length,
    });
    riskManager.updatePnlHistory(aggregateAccount.equity);

    log('=== Trading Loop End ===');
  } catch (err) {
    console.error('[TradingEngine] Loop error:', err);
  }
}

export async function runStatusSync(): Promise<void> {
  try {
    const completed = await executor.syncBotStatuses();
    const enabledAccounts = useConfigStore.getState().accounts.filter((a) => a.enabled);
    const store = useTradingStore.getState();

    if (completed.length) {
      log('Sync: completed bots:', completed);
      for (const c of completed) {
        if (c.pnl !== undefined) {
          onTradeCompleted(Number(c.pnl), Number(c.volume || 0));
          const botId = String(c.order_id || '');
          if (botId) lastKnownVolume.delete(botId);
        }
      }
    }

    // Aggregate balances
    let totalEquity = 0;
    let totalUnrealizedPnl = 0;
    for (const acct of enabledAccounts) {
      try {
        const info = await treadApi.getAccountInfo(acct.name);
        totalEquity += info.equity;
        totalUnrealizedPnl += info.unrealized_pnl;
      } catch { /* skip */ }
    }

    store.setAccount({
      balance: totalEquity - totalUnrealizedPnl,
      equity: totalEquity,
      unrealized_pnl: totalUnrealizedPnl,
      margin_used: 0,
    });
    store.setLastSyncTime(Date.now());

    // Live volume tracking
    const { perBot } = await treadApi.getActiveBotsVolume();
    let totalDelta = 0;
    for (const { id, volume } of perBot) {
      const prev = lastKnownVolume.get(id) || 0;
      const delta = volume - prev;
      if (delta > 0) totalDelta += delta;
      lastKnownVolume.set(id, volume);
    }
    if (totalDelta > 0) {
      usePetStore.getState().addVolume(totalDelta);
    }
  } catch (err) {
    console.error('[TradingEngine] Sync error:', err);
  }
}

async function buildTradeHistory(): Promise<{ tradeHistory: string; patternAnalysis: string; lessonsContext: string }> {
  const { formatTradeHistory, analyzePatterns, generateLessons } = await import('@/engine/ai/promptBuilder');
  const tradesWithOutcomes = await db.getTradesWithOutcomes(30);
  return {
    tradeHistory: formatTradeHistory(tradesWithOutcomes),
    patternAnalysis: analyzePatterns(tradesWithOutcomes),
    lessonsContext: generateLessons(tradesWithOutcomes),
  };
}

async function buildPerformance(equity: number): Promise<string> {
  const outcomes = await db.getTradeOutcomes(20);
  if (!outcomes.length) return `No trades yet. Current equity: $${equity.toFixed(2)}.`;

  const totalPnl = outcomes.reduce((sum, o) => sum + o.realized_pnl, 0);
  const wins = outcomes.filter((o) => o.realized_pnl > 0).length;
  const losses = outcomes.filter((o) => o.realized_pnl < 0).length;
  const initial = Number(localStorage.getItem('initial_capital') || 100);

  return [
    `Last ${outcomes.length} bots: ${wins}W / ${losses}L, total PnL $${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}`,
    `Starting capital: $${initial.toFixed(0)} → Current equity: $${equity.toFixed(2)} (${(((equity / initial) - 1) * 100).toFixed(1)}%)`,
  ].join('\n');
}
