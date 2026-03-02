/**
 * Trading engine -- 5-minute core loop (server-side port).
 * One Claude call per cycle. Returns array of trades across all exchanges.
 *
 * Key differences from client-side:
 *   - No Zustand stores (useTradingStore, usePetStore, useConfigStore).
 *   - All persistence via repository (SQLite) and configStore.
 *   - All API calls via server-side clients (direct HTTP, no proxy).
 *   - Bot volume tracking via repository.getBotVolume()/setBotVolume().
 *   - Accepts AbortSignal for graceful shutdown between async steps.
 *   - Parallelized order book fetches via Promise.allSettled().
 *   - PnL history for Sharpe ratio derived from pnl_snapshots at startup.
 *   - SSE events emitted after state changes.
 *   - Pet state updates via repository (no zustand pet store).
 */
import * as treadApi from '@/server/clients/treadApi';
import * as treadtoolsApi from '@/server/clients/treadtoolsApi';
import * as tradingviewApi from '@/server/clients/tradingviewApi';
import { MAX_POSITION_PCT, MAX_BOTS_PER_CYCLE, MAX_CONCURRENT_BOTS } from '@/lib/constants';
import { onTradeCompleted } from '@/server/engine/pet/petStateMachine';
import { riskManager } from '@/server/engine/riskManager';
import { getActivePairs } from '@/server/engine/pairSelector';
import { classifyRegime, regimeToContextString } from '@/server/engine/regimeClassifier';
import * as executor from '@/server/engine/executor';
import { orderMonitor } from '@/server/engine/orderMonitor';
import { makeDecisions } from '@/server/engine/ai/decisionEngine';
import * as repository from '@/server/db/repository';
import * as configStore from '@/server/db/configStore';
import { sseEmitter } from '@/server/engine/sseEmitter';
import { dbCircuitBreaker } from '@/server/engine/dbCircuitBreaker';
import { formatTradeHistory, analyzePatterns, generateLessons } from '@/server/engine/ai/promptBuilder';
import type { AccountInfo } from '@/lib/types';

function log(msg: string, ...args: unknown[]) {
  console.log(`[TradingEngine] ${msg}`, ...args);
}

/** Check if the abort signal has been fired; throws if so. */
function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Trading loop aborted', 'AbortError');
  }
}

// ---------------------------------------------------------------------------
// Main trading loop
// ---------------------------------------------------------------------------

export async function runTradingLoop(signal?: AbortSignal): Promise<void> {
  // Refuse to trade if the DB circuit breaker is tripped
  if (dbCircuitBreaker.tripped) {
    log('=== Trading Loop SKIPPED -- DB circuit breaker is open ===');
    return;
  }

  const accounts = configStore.getConfig<Array<{ name: string; id: string; exchange: string; enabled: boolean }>>('accounts') || [];
  const enabledAccounts = accounts.filter((a) => a.enabled);
  log('=== Trading Loop Start ===');

  if (!enabledAccounts.length) {
    log('No enabled accounts, skipping');
    return;
  }

  try {
    checkAbort(signal);

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

    checkAbort(signal);

    // 2. Fetch TreadTools per unique exchange
    const exchanges = [...new Set(enabledAccounts.map((a) => a.exchange))];
    const treadtoolsLines: string[] = [];
    let lastSnapshot = null;
    let allActivePairs: string[] = [];

    for (const exchange of exchanges) {
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
      checkAbort(signal);
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
    } catch (err) {
      console.warn('[TradingEngine] TradingView data failed (degraded):', err);
    }

    checkAbort(signal);

    // 3b. Regime classification
    const regimes = allActivePairs.map((pair) => {
      const tv = tvAnalyses[pair];
      const tt = lastSnapshot?.all_markets.find((m) => m.symbol === pair.replace('-USD', ''));
      return classifyRegime(pair, tv, tt);
    });
    const regimeCtx = regimeToContextString(regimes);
    log(`Regimes: ${regimes.map((r) => `${r.pair}=${r.regime}`).join(', ')}`);

    // 3c. Order book depth + imbalance (PARALLELIZED)
    let orderbookCtx = 'Order book data not available.';
    try {
      const pairsToFetch = allActivePairs.slice(0, 6);
      const acctName = enabledAccounts[0]?.name || 'Paradex';

      // Fetch all order books in parallel
      const obResults = await Promise.allSettled(
        pairsToFetch.map((pair) => treadApi.getOrderBook(pair, acctName)),
      );

      const obLines = [
        '| Pair | Bid Depth ($) | Ask Depth ($) | Imbalance | Spread (bps) |',
        '|------|--------------|--------------|-----------|-------------|',
      ];
      let hasData = false;

      for (let idx = 0; idx < pairsToFetch.length; idx++) {
        const result = obResults[idx];
        if (result.status !== 'fulfilled') continue;

        const book = result.value;
        const pair = pairsToFetch[idx];
        const bids = (book.bids || []) as Array<Record<string, unknown> | [number, number]>;
        const asks = (book.asks || []) as Array<Record<string, unknown> | [number, number]>;
        if (!bids.length || !asks.length) continue;

        let bidDepth = 0, askDepth = 0;
        const topN = 10;
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

        const bestBid = Array.isArray(bids[0]) ? bids[0][0] : Number((bids[0] as Record<string, unknown>).price || 0);
        const bestAsk = Array.isArray(asks[0]) ? asks[0][0] : Number((asks[0] as Record<string, unknown>).price || 0);
        const mid = (bestBid + bestAsk) / 2;
        const spreadBps = mid > 0 ? ((bestAsk - bestBid) / mid) * 10000 : 0;

        obLines.push(`| ${pair} | $${(bidDepth / 1000).toFixed(1)}k | $${(askDepth / 1000).toFixed(1)}k | ${imbalanceLabel} | ${spreadBps.toFixed(1)} bps |`);
        hasData = true;
      }
      if (hasData) orderbookCtx = obLines.join('\n');
    } catch (err) {
      console.warn('[TradingEngine] Order book data failed (degraded):', err);
    }

    checkAbort(signal);

    // 4. Fetch per-account balances + positions
    let totalEquity = 0;
    let totalUnrealizedPnl = 0;
    const allPositions: Awaited<ReturnType<typeof treadApi.getPositions>> = [];
    const accountInfoMap = new Map<string, AccountInfo>();
    const accountsCtxLines: string[] = [];

    const MIN_EQUITY_TO_TRADE = 5;
    const tradableAccounts: typeof enabledAccounts = [];

    for (const acct of enabledAccounts) {
      try {
        const info = await treadApi.getAccountInfo(acct.name);
        const pos = await treadApi.getPositions(acct.name);

        if (info.equity < MIN_EQUITY_TO_TRADE) {
          log(`  ${acct.name}: eq=$${info.equity.toFixed(2)} -- below $${MIN_EQUITY_TO_TRADE} threshold, skipping`);
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
        sseEmitter.emit('error', { message: `Account ${acct.name} unreachable` });
      }
      checkAbort(signal);
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

    // Emit account update via SSE
    sseEmitter.emit('account_updated', {
      account: aggregateAccount,
      positions: allPositions,
    });

    // 5. Global risk check
    const metrics = riskManager.calculateMetrics(aggregateAccount.balance, allPositions);
    log(`Risk: dd=${(metrics.drawdown_pct * 100).toFixed(1)}% can_trade=${metrics.can_trade}`);
    configStore.setConfig('last_drawdown_pct', metrics.drawdown_pct);

    if (!metrics.can_trade) {
      log(`Trading paused: ${metrics.risk_message}`);
      sseEmitter.emit('engine_status', { paused: true, reason: metrics.risk_message });
      return;
    }

    checkAbort(signal);

    // 6. Build shared context
    const recentPerf = buildPerformance(aggregateAccount.equity);
    const { tradeHistory, patternAnalysis, lessonsContext } = buildTradeHistory();

    // 7. ONE Claude call -> array of trades
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

    checkAbort(signal);

    if (!decisions.length) {
      log('Decision: HOLD (no trades)');
      const portfolio = { balance: aggregateAccount.balance, equity: totalEquity, unrealized_pnl: totalUnrealizedPnl, exposure_pct: metrics.exposure_pct };
      repository.addDecision({
        timestamp: Date.now(),
        action: 'hold',
        pair: null,
        reasoning: 'No opportunities across all exchanges.',
        active_pairs: JSON.stringify(allActivePairs),
        calm_pairs: JSON.stringify(lastSnapshot?.calm_pairs || []),
        portfolio: JSON.stringify(portfolio),
      });
      repository.saveActivity({
        timestamp: Date.now(),
        category: 'decision',
        action: 'hold',
        pair: null,
        detail: JSON.stringify({ reasoning: 'No opportunities across all exchanges.', active_pairs: allActivePairs, calm_pairs: lastSnapshot?.calm_pairs || [], portfolio }),
      });
      sseEmitter.emit('decision_made', { action: 'hold', portfolio });
    }

    // 8. Execute each trade (deduplicate: one pair per account, margin cap per account)
    const activeTrades = repository.getActiveTradesOnly();
    let availableSlots = MAX_CONCURRENT_BOTS - activeTrades.length;
    if (availableSlots <= 0) {
      log(`Max concurrent bots reached (${activeTrades.length}/${MAX_CONCURRENT_BOTS}), skipping new executions`);
    }

    const existingPairAccounts = new Set(
      activeTrades.map((t) => `${t.pair}::${t.account_name}`),
    );
    const executedPairAccounts = new Set<string>();
    const allocatedMargin = new Map<string, number>();
    let botsThisCycle = 0;
    for (const decision of decisions) {
      checkAbort(signal);

      if (botsThisCycle >= MAX_BOTS_PER_CYCLE || availableSlots <= 0) break;

      if (decision.action !== 'market_make' || !decision.pair || !decision.account) {
        log(`  Skipping invalid decision: ${JSON.stringify(decision).slice(0, 100)}`);
        continue;
      }

      const acct = tradableAccounts.find((a) => a.name === decision.account);
      if (!acct) {
        log(`  Account "${decision.account}" not found, skipping`);
        continue;
      }

      const dedupeKey = `${decision.pair}::${acct.name}`;
      if (existingPairAccounts.has(dedupeKey)) {
        log(`  Skipping: active bot already exists for ${decision.pair} on ${acct.name}`);
        continue;
      }
      if (executedPairAccounts.has(dedupeKey)) {
        log(`  Skipping duplicate: ${decision.pair} on ${acct.name} (already submitted this cycle)`);
        continue;
      }
      executedPairAccounts.add(dedupeKey);

      // Pair eligibility check — reject pairs not in the active set
      if (!allActivePairs.includes(decision.pair)) {
        log(`  Rejecting ineligible pair: ${decision.pair}`);
        continue;
      }

      // Cumulative margin cap at 90% per account
      const accountEquity = accountInfoMap.get(acct.name)?.equity || 0;
      const thisMargin = Math.min(decision.margin || 0, accountEquity * MAX_POSITION_PCT);
      const currentAllocated = allocatedMargin.get(acct.name) || 0;
      if (currentAllocated + thisMargin > accountEquity * 0.90) {
        log(`  Skipping ${decision.pair} on ${acct.name}: margin cap reached (allocated=$${currentAllocated.toFixed(2)} + $${thisMargin.toFixed(2)} > 90% of $${accountEquity.toFixed(2)})`);
        continue;
      }

      log(`  Executing: ${decision.pair} on ${acct.name} | margin=$${decision.margin} lev=${decision.leverage}x | ${decision.reasoning.slice(0, 80)}`);

      const result = await executor.executeMm(decision, accountEquity, acct.name, acct.exchange);
      if (result) {
        allocatedMargin.set(acct.name, currentAllocated + thisMargin);
        botsThisCycle++;
        availableSlots--;
      }
      log(result ? `  Bot launched: ${String(result.id || '').slice(0, 12)}` : '  Execution failed');

      const tradeReasoning = `[${acct.name} -- ${decision.reference_price || 'mid'} -- ${decision.leverage || 0}x -- $${decision.margin || 0}] ${decision.reasoning}`;
      const portfolio = { balance: aggregateAccount.balance, equity: totalEquity, unrealized_pnl: totalUnrealizedPnl, exposure_pct: metrics.exposure_pct };
      repository.addDecision({
        timestamp: Date.now(),
        action: 'market_make',
        pair: decision.pair,
        reasoning: tradeReasoning,
        active_pairs: JSON.stringify(allActivePairs),
        calm_pairs: JSON.stringify(lastSnapshot?.calm_pairs || []),
        portfolio: JSON.stringify(portfolio),
      });
      repository.saveActivity({
        timestamp: Date.now(),
        category: 'decision',
        action: 'trade',
        pair: decision.pair,
        detail: JSON.stringify({ account: acct.name, reasoning: tradeReasoning, mode: decision.reference_price || 'mid', leverage: decision.leverage, margin: decision.margin, portfolio }),
      });
      sseEmitter.emit('decision_made', {
        action: 'market_make',
        pair: decision.pair,
        account: acct.name,
        portfolio,
      });
    }

    // 9. Save PnL snapshot
    repository.savePnlSnapshot({
      timestamp: Date.now(),
      balance: aggregateAccount.balance,
      equity: aggregateAccount.equity,
      unrealized_pnl: aggregateAccount.unrealized_pnl,
      num_positions: allPositions.length,
    });
    riskManager.updatePnlHistory(aggregateAccount.equity);
    sseEmitter.emit('pnl_snapshot', {
      balance: aggregateAccount.balance,
      equity: aggregateAccount.equity,
      unrealized_pnl: aggregateAccount.unrealized_pnl,
      num_positions: allPositions.length,
    });

    log('=== Trading Loop End ===');
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      log('Trading loop aborted by signal');
      return;
    }
    console.error('[TradingEngine] Loop error:', err);
    sseEmitter.emit('error', {
      message: 'Trading loop error. Next cycle will retry.',
      detail: err instanceof Error ? err.message : String(err),
    });
    repository.saveActivity({
      timestamp: Date.now(),
      category: 'error',
      action: 'loop_error',
      pair: null,
      detail: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
    });
  }
}

// ---------------------------------------------------------------------------
// Status sync (called every 30s)
// ---------------------------------------------------------------------------

export async function runStatusSync(signal?: AbortSignal): Promise<void> {
  try {
    checkAbort(signal);

    const completed = await executor.syncBotStatuses();
    const accounts = configStore.getConfig<Array<{ name: string; id: string; exchange: string; enabled: boolean }>>('accounts') || [];
    const enabledAccounts = accounts.filter((a) => a.enabled);

    if (completed.length) {
      log('Sync: completed bots:', completed);
      for (const c of completed) {
        if (c.pnl !== undefined) {
          onTradeCompleted(Number(c.pnl), Number(c.volume || 0));
          const botId = String(c.order_id || '');
          // No need to delete from in-memory map -- bot_volumes table
          // entries are naturally overwritten or ignored for completed bots
        }
      }
    }

    checkAbort(signal);

    // Aggregate balances
    let totalEquity = 0;
    let totalUnrealizedPnl = 0;
    let fetchFailures = 0;
    for (const acct of enabledAccounts) {
      try {
        const info = await treadApi.getAccountInfo(acct.name);
        totalEquity += info.equity;
        totalUnrealizedPnl += info.unrealized_pnl;
      } catch (err) {
        fetchFailures++;
        console.error(`[Sync] ${acct.name} balance failed:`, err);
      }
    }

    // Don't push $0 equity to client if all accounts failed to fetch
    if (totalEquity === 0 && enabledAccounts.length > 0 && fetchFailures > 0) {
      log(`Sync: skipping account_updated SSE — all ${fetchFailures} account(s) failed`);
    } else {
      const aggregateAccount: AccountInfo = {
        balance: totalEquity - totalUnrealizedPnl,
        equity: totalEquity,
        unrealized_pnl: totalUnrealizedPnl,
        margin_used: 0,
      };

      sseEmitter.emit('account_updated', {
        account: aggregateAccount,
        lastSyncTime: Date.now(),
      });
    }

    checkAbort(signal);

    // Order monitor -- check for stale orders + push active bots to UI
    let activeBots: Array<Record<string, unknown>> = [];
    try {
      activeBots = await treadApi.getActiveMmBots();
      await orderMonitor.checkOrders(activeBots);
    } catch (e) {
      console.error('[TradingEngine] Order monitor error:', e);
    }

    checkAbort(signal);

    // Live volume tracking — compute from already-fetched activeBots
    let totalDelta = 0;
    for (const bot of activeBots) {
      const id = String(bot.id || '');
      const volume = Number(bot.executed_notional || 0);
      if (!id) continue;
      const prev = repository.getBotVolume(id);
      const delta = volume - prev;
      if (delta > 0) totalDelta += delta;
      repository.setBotVolume(id, volume);
    }
    if (totalDelta > 0) {
      // Update pet cumulative volume directly in SQLite
      const petRow = repository.getPetState();
      if (petRow && petRow.is_alive) {
        const newVolume = (petRow.cumulative_volume || 0) + totalDelta;
        repository.updatePetState({ cumulative_volume: newVolume });
        sseEmitter.emit('pet_updated', { cumulative_volume: newVolume, volume_delta: totalDelta });
      }
    }

    sseEmitter.emit('bot_synced', {
      activeBots: Array.isArray(activeBots) ? activeBots : [],
      completedCount: completed.length,
      totalEquity,
      timestamp: Date.now(),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      log('Status sync aborted by signal');
      return;
    }
    console.error('[TradingEngine] Sync error:', err);
    sseEmitter.emit('error', {
      message: 'Status sync error. Will retry next cycle.',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Trade history + performance context builders (synchronous, use repository)
// ---------------------------------------------------------------------------

function buildTradeHistory(): { tradeHistory: string; patternAnalysis: string; lessonsContext: string } {
  // Cast needed: drizzle infers outcome as string, but prompt builder expects union type
  const tradesWithOutcomes = repository.getTradesWithOutcomes(30) as unknown as Array<{
    trade: import('@/lib/types').TradeRecord & { id: number };
    outcome: import('@/lib/types').TradeOutcome | null;
  }>;
  return {
    tradeHistory: formatTradeHistory(tradesWithOutcomes),
    patternAnalysis: analyzePatterns(tradesWithOutcomes),
    lessonsContext: generateLessons(tradesWithOutcomes),
  };
}

function buildPerformance(equity: number): string {
  const outcomes = repository.getTradeOutcomes(20);
  if (!outcomes.length) return `No trades yet. Current equity: $${equity.toFixed(2)}.`;

  const totalPnl = outcomes.reduce((sum, o) => sum + o.realized_pnl, 0);
  const wins = outcomes.filter((o) => o.realized_pnl > 0).length;
  const losses = outcomes.filter((o) => o.realized_pnl < 0).length;
  const initial = configStore.getConfig<number>('initial_capital') ?? 100;

  return [
    `Last ${outcomes.length} bots: ${wins}W / ${losses}L, total PnL $${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}`,
    `Starting capital: $${initial.toFixed(0)} -> Current equity: $${equity.toFixed(2)} (${(((equity / initial) - 1) * 100).toFixed(1)}%)`,
  ].join('\n');
}

