/**
 * Trading engine — the 5-minute core loop.
 * Ported from treadbot/backend/app/trading/loop.py.
 */
import * as treadApi from '@/clients/treadApi';
import { exchangeToTreadtools } from '@/clients/treadApi';
import * as treadtoolsApi from '@/clients/treadtoolsApi';
import * as tradingviewApi from '@/clients/tradingviewApi';
import { riskManager } from './riskManager';
import { getActivePairs } from './pairSelector';
import * as executor from './executor';
import { makeDecision } from '@/engine/ai/decisionEngine';
import { useConfigStore } from '@/store/useConfigStore';
import { useTradingStore } from '@/store/useTradingStore';
import { usePetStore } from '@/store/usePetStore';
import { onTradeCompleted } from '@/engine/pet/petStateMachine';
import * as db from '@/persistence/db';
import type { AccountInfo, DecisionLogEntry, TreadAccount } from '@/lib/types';

function log(msg: string, ...args: unknown[]) {
  console.log(`[TradingEngine] ${msg}`, ...args);
}

// Track last-known volume per bot to compute deltas
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
    // 1. Fetch TreadTools data per unique exchange across all enabled accounts
    const exchanges = [...new Set(enabledAccounts.map((a) => a.exchange))];
    const treadtoolsLines: string[] = [];
    let combinedSnapshot = null;
    let allActivePairs: string[] = [];

    for (const exchange of exchanges) {
      const ttEndpoint = exchangeToTreadtools(exchange);
      log(`Fetching TreadTools for ${exchange} (${ttEndpoint})...`);
      const snapshot = await treadtoolsApi.getSnapshot(exchange);
      if (snapshot) {
        combinedSnapshot = snapshot; // keep last one for fallback decision
        const ctx = treadtoolsApi.toContextString(snapshot);
        const accountsOnExchange = enabledAccounts.filter((a) => a.exchange === exchange).map((a) => a.name);
        treadtoolsLines.push(`### ${exchange} (accounts: ${accountsOnExchange.join(', ')})\n${ctx}`);
        const pairs = getActivePairs(snapshot);
        allActivePairs = [...new Set([...allActivePairs, ...pairs])];
        log(`  ${exchange}: ${snapshot.calm_pairs.length} eligible pairs`);
      }
    }

    const treadtoolsCtx = treadtoolsLines.length
      ? treadtoolsLines.join('\n\n')
      : 'Treadtools unavailable. HOLD.';
    log('Active pairs (all exchanges):', allActivePairs);

    // 2. Fetch TradingView technical analysis
    let tvContext = 'TradingView data unavailable.';
    try {
      const tvAnalyses = await tradingviewApi.getAnalysis(allActivePairs);
      if (Object.keys(tvAnalyses).length) {
        tvContext = tradingviewApi.toContextString(tvAnalyses);
        log(`TradingView: got analysis for ${Object.keys(tvAnalyses).join(', ')}`);
      }
    } catch (e) {
      log('TradingView fetch failed (non-fatal):', e);
    }

    // 3. Fetch positions + account info per enabled account, aggregate
    log('Fetching account data...');
    let totalEquity = 0;
    let totalUnrealizedPnl = 0;
    const allPositions = [];
    const accountsCtxLines: string[] = [];
    const accountInfoMap = new Map<string, AccountInfo>();

    for (const acct of enabledAccounts) {
      try {
        const info = await treadApi.getAccountInfo(acct.name);
        const pos = await treadApi.getPositions(acct.name);
        accountInfoMap.set(acct.name, info);
        totalEquity += info.equity;
        totalUnrealizedPnl += info.unrealized_pnl;
        allPositions.push(...pos);
        accountsCtxLines.push(
          `- **${acct.name}** (${acct.exchange}): bal=$${info.balance.toFixed(2)} eq=$${info.equity.toFixed(2)} uPnL=$${info.unrealized_pnl >= 0 ? '+' : ''}${info.unrealized_pnl.toFixed(2)} | ${pos.length} positions`,
        );
        log(`  ${acct.name}: eq=$${info.equity.toFixed(2)} | ${pos.length} positions`);
      } catch (e) {
        log(`  ${acct.name}: failed to fetch - ${e}`);
      }
    }

    const accountsContext = accountsCtxLines.join('\n');
    const aggregateAccount: AccountInfo = {
      balance: totalEquity - totalUnrealizedPnl,
      equity: totalEquity,
      unrealized_pnl: totalUnrealizedPnl,
      margin_used: 0,
    };
    store.setAccount(aggregateAccount);
    store.setPositions(allPositions);

    // 4. Sync bot statuses + notify pet
    const completed = await executor.syncBotStatuses();
    if (completed.length) {
      log('Completed bots:', completed);
      for (const c of completed) {
        if (c.pnl !== undefined) {
          onTradeCompleted(Number(c.pnl), Number(c.volume || 0));
        }
      }
    }

    // 5. Calculate risk metrics
    const metrics = riskManager.calculateMetrics(aggregateAccount.balance, allPositions);
    store.setRiskMetrics(metrics);
    log(`Risk: exp=${(metrics.exposure_pct * 100).toFixed(1)}% dd=${(metrics.drawdown_pct * 100).toFixed(1)}% can_trade=${metrics.can_trade}`);

    if (!metrics.can_trade) {
      log(`Trading paused: ${metrics.risk_message}`);
      logDecision('hold', null, metrics.risk_message, allActivePairs, combinedSnapshot, aggregateAccount, metrics);
      log('=== Trading Loop End (paused) ===');
      return;
    }

    // 6. Build performance summary + trade history for AI learning
    const recentPerf = await buildPerformance(aggregateAccount.equity);
    const { tradeHistory, patternAnalysis } = await buildTradeHistory();

    // 7. Make decision (Claude or rule-based)
    const maxMargin = riskManager.maxMargin(aggregateAccount.equity);
    const available = riskManager.availableMargin(aggregateAccount.equity, metrics.total_exposure);
    log(`Margin: max=$${maxMargin.toFixed(2)} available=$${available.toFixed(2)}`);

    log('Requesting decision...');
    const decision = await makeDecision({
      equity: aggregateAccount.equity,
      unrealizedPnl: metrics.unrealized_pnl,
      maxMargin,
      available,
      positions: allPositions,
      accountsContext,
      treadtoolsContext: treadtoolsCtx,
      tradingviewContext: tvContext,
      recentPerformance: recentPerf,
      tradeHistory,
      patternAnalysis,
      snapshot: combinedSnapshot,
      metrics,
    });
    log(`Decision: ${decision.action} | ${decision.account || 'n/a'} | ${decision.pair || 'n/a'} | ${decision.reasoning.slice(0, 120)}`);

    // 8. Log decision
    logDecision(decision.action, decision.pair || null, decision.reasoning, allActivePairs, combinedSnapshot, aggregateAccount, metrics);
    store.setLastDecisionTime(Date.now());

    // 9. Execute if market_make
    if (decision.action === 'market_make') {
      // Resolve account — use the one Claude specified, or first enabled account on matching exchange
      const targetAccount = decision.account
        ? enabledAccounts.find((a) => a.name === decision.account)?.name
        : enabledAccounts[0]?.name;

      if (!targetAccount) {
        log('No matching account found for execution');
      } else {
        const accountEquity = accountInfoMap.get(targetAccount)?.equity || aggregateAccount.equity;
        log(`Executing MM: ${decision.pair} margin=$${decision.margin} lev=${decision.leverage}x on ${targetAccount}`);
        const result = await executor.executeMm(decision, accountEquity, targetAccount);
        log(result ? `MM bot launched: ${JSON.stringify(result).slice(0, 200)}` : 'MM execution returned null');
      }
    }

    // 10. Save PnL snapshot
    await db.savePnlSnapshot({
      timestamp: Date.now(),
      balance: aggregateAccount.balance,
      equity: aggregateAccount.equity,
      unrealized_pnl: aggregateAccount.unrealized_pnl,
      num_positions: allPositions.length,
    });

    // 11. Update Sharpe history
    riskManager.updatePnlHistory(aggregateAccount.equity);

    log('=== Trading Loop End ===');
  } catch (err) {
    console.error('[TradingEngine] Loop error:', err);
  }
}

export async function runStatusSync(): Promise<void> {
  try {
    const completed = await executor.syncBotStatuses();
    const account = await treadApi.getAccountInfo();
    const positions = await treadApi.getPositions();
    const store = useTradingStore.getState();
    store.setAccount(account);
    store.setPositions(positions);
    store.setLastSyncTime(Date.now());

    // Notify pet of completed bots
    if (completed.length) {
      log('Sync: completed bots:', completed);
      for (const c of completed) {
        if (c.pnl !== undefined) {
          onTradeCompleted(Number(c.pnl), Number(c.volume || 0));
          // Clean up tracking for completed bot
          const botId = String(c.order_id || '');
          if (botId) lastKnownVolume.delete(botId);
        }
      }
    }

    // Poll live volume from active bots and add deltas
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
      log(`Live volume delta: +$${totalDelta.toFixed(2)} (total: $${usePetStore.getState().cumulative_volume.toFixed(2)})`);
    }
  } catch (err) {
    console.error('[TradingEngine] Sync error:', err);
  }
}

async function buildTradeHistory(): Promise<{ tradeHistory: string; patternAnalysis: string }> {
  const { formatTradeHistory, analyzePatterns } = await import('@/engine/ai/promptBuilder');
  const tradesWithOutcomes = await db.getTradesWithOutcomes(30);
  return {
    tradeHistory: formatTradeHistory(tradesWithOutcomes),
    patternAnalysis: analyzePatterns(tradesWithOutcomes),
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

function logDecision(
  action: string,
  pair: string | null,
  reasoning: string,
  activePairs: string[],
  snapshot: { calm_pairs: string[] } | null,
  account: { balance: number; equity: number },
  metrics: { unrealized_pnl: number; exposure_pct: number },
): void {
  const entry: DecisionLogEntry = {
    timestamp: new Date().toISOString(),
    action,
    pair,
    reasoning,
    active_pairs: activePairs,
    calm_pairs: snapshot?.calm_pairs || [],
    portfolio: {
      balance: account.balance,
      equity: account.equity,
      unrealized_pnl: metrics.unrealized_pnl,
      exposure_pct: metrics.exposure_pct,
    },
  };
  useTradingStore.getState().addDecision(entry);
}
