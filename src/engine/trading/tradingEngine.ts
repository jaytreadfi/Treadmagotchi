/**
 * Trading engine — the 5-minute core loop.
 * Ported from treadbot/backend/app/trading/loop.py.
 */
import * as treadApi from '@/clients/treadApi';
import * as treadtoolsApi from '@/clients/treadtoolsApi';
import * as hyperliquidApi from '@/clients/hyperliquidApi';
import * as tradingviewApi from '@/clients/tradingviewApi';
import { riskManager } from './riskManager';
import { getActivePairs } from './pairSelector';
import * as executor from './executor';
import { makeDecision } from '@/engine/ai/decisionEngine';
import { useTradingStore } from '@/store/useTradingStore';
import { usePetStore } from '@/store/usePetStore';
import { onTradeCompleted } from '@/engine/pet/petStateMachine';
import * as db from '@/persistence/db';
import type { DecisionLogEntry } from '@/lib/types';

function log(msg: string, ...args: unknown[]) {
  console.log(`[TradingEngine] ${msg}`, ...args);
}

// Track last-known volume per bot to compute deltas
const lastKnownVolume = new Map<string, number>();

export async function runTradingLoop(): Promise<void> {
  const store = useTradingStore.getState();
  log('=== Trading Loop Start ===');

  try {
    // 1. Fetch TreadTools snapshot
    log('Fetching TreadTools data...');
    const snapshot = await treadtoolsApi.getSnapshot();
    const treadtoolsCtx = snapshot
      ? treadtoolsApi.toContextString(snapshot)
      : 'Treadtools unavailable. HOLD.';
    log(`TreadTools: ${snapshot ? `${snapshot.calm_pairs.length} calm pairs` : 'unavailable'}`);

    // 2. Select active pairs
    const activePairs = getActivePairs(snapshot);
    log('Active pairs:', activePairs);

    // 3. Fetch mid prices from Hyperliquid
    let allMids: Record<string, number> = {};
    try {
      allMids = await hyperliquidApi.getAllMids();
      log(`Hyperliquid: ${Object.keys(allMids).length} mid prices`);
    } catch (e) {
      log('Hyperliquid mids failed (non-fatal):', e);
    }

    // 3b. Fetch TradingView technical analysis for active pairs
    let tvContext = 'TradingView data unavailable.';
    try {
      const tvAnalyses = await tradingviewApi.getAnalysis(activePairs);
      if (Object.keys(tvAnalyses).length) {
        tvContext = tradingviewApi.toContextString(tvAnalyses);
        log(`TradingView: got analysis for ${Object.keys(tvAnalyses).join(', ')}`);
      }
    } catch (e) {
      log('TradingView fetch failed (non-fatal):', e);
    }

    // 4. Fetch positions + account from Tread
    log('Fetching Tread account...');
    const positions = await treadApi.getPositions();
    const account = await treadApi.getAccountInfo();
    store.setAccount(account);
    store.setPositions(positions);
    log(`Account: bal=$${account.balance.toFixed(2)} eq=$${account.equity.toFixed(2)} uPnL=$${account.unrealized_pnl.toFixed(2)} | ${positions.length} positions`);

    // 5. Sync bot statuses + notify pet
    const completed = await executor.syncBotStatuses();
    if (completed.length) {
      log('Completed bots:', completed);
      for (const c of completed) {
        if (c.pnl !== undefined) {
          onTradeCompleted(Number(c.pnl), Number(c.volume || 0));
        }
      }
    }

    // 6. Calculate risk metrics
    const metrics = riskManager.calculateMetrics(account.balance, positions);
    store.setRiskMetrics(metrics);
    log(`Risk: exp=${(metrics.exposure_pct * 100).toFixed(1)}% dd=${(metrics.drawdown_pct * 100).toFixed(1)}% can_trade=${metrics.can_trade}`);

    // 7. Check if trading allowed
    if (!metrics.can_trade) {
      log(`Trading paused: ${metrics.risk_message}`);
      logDecision('hold', null, metrics.risk_message, activePairs, snapshot, account, metrics);
      log('=== Trading Loop End (paused) ===');
      return;
    }

    // 8. Build performance summary + trade history for AI learning
    const recentPerf = await buildPerformance(account.equity);
    const { tradeHistory, patternAnalysis } = await buildTradeHistory();

    // 9. Make decision (Claude or rule-based)
    const maxMargin = riskManager.maxMargin(account.equity);
    const available = riskManager.availableMargin(account.equity, metrics.total_exposure);
    log(`Margin: max=$${maxMargin.toFixed(2)} available=$${available.toFixed(2)}`);

    log('Requesting decision...');
    const decision = await makeDecision({
      balance: account.balance,
      equity: account.equity,
      unrealizedPnl: metrics.unrealized_pnl,
      maxMargin,
      available,
      positions,
      treadtoolsContext: treadtoolsCtx,
      tradingviewContext: tvContext,
      recentPerformance: recentPerf,
      tradeHistory,
      patternAnalysis,
      snapshot,
      metrics,
    });
    log(`Decision: ${decision.action} | ${decision.pair || 'n/a'} | ${decision.reasoning.slice(0, 120)}`);

    // 10. Log decision
    logDecision(decision.action, decision.pair || null, decision.reasoning, activePairs, snapshot, account, metrics);
    store.setLastDecisionTime(Date.now());

    // 11. Execute if market_make
    if (decision.action === 'market_make') {
      log(`Executing MM: ${decision.pair} margin=$${decision.margin} lev=${decision.leverage}x`);
      const result = await executor.executeMm(decision, account.equity, allMids);
      log(result ? `MM bot launched: ${JSON.stringify(result).slice(0, 200)}` : 'MM execution returned null');
    }

    // 12. Save PnL snapshot
    const equity = account.balance + metrics.unrealized_pnl;
    await db.savePnlSnapshot({
      timestamp: Date.now(),
      balance: account.balance,
      equity,
      unrealized_pnl: metrics.unrealized_pnl,
      num_positions: positions.length,
    });

    // 13. Update Sharpe history
    riskManager.updatePnlHistory(equity);

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
