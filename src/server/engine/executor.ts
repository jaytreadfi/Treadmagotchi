/**
 * Executor -- server-side port.
 *
 * Validates, submits, and syncs MM bots via Tread API.
 *
 * Key changes from client-side:
 *   - Uses server-side treadApi and hyperliquidApi directly (no proxy).
 *   - Write-ahead pattern for trade execution:
 *       1. repository.saveTrade({ status: 'pending' })  -- write-ahead
 *       2. treadApi.submitMmOrder(params)                -- submit
 *       3. treadApi.changeMmSpread(...)                  -- configure
 *       4. repository.updateTradeStatus(id, 'submitted') -- confirm
 *       On failure: mark trade as 'failed' in DB.
 *   - Stores intended mm_params in write-ahead record for reconciliation.
 *   - Persists trade outcomes and activity to SQLite via repository.
 */
import {
  MAX_LEVERAGE, MAX_MM_DURATION, MAX_POSITION_PCT, MAX_SPREAD_BPS,
} from '@/lib/constants';
import type { AIDecision } from '@/lib/types';
import * as treadApi from '@/server/clients/treadApi';
import * as hyperliquidApi from '@/server/clients/hyperliquidApi';
import * as repository from '@/server/db/repository';
import { riskManager } from '@/server/engine/riskManager';
import { orderMonitor } from '@/server/engine/orderMonitor';
import { dbCircuitBreaker } from '@/server/engine/dbCircuitBreaker';
import { sseEmitter } from '@/server/engine/sseEmitter';

const STATUS_MAP: Record<string, string> = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  CANCELED: 'canceled',
  CANCELLED: 'canceled',
  FAILED: 'failed',
  SUBMITTED: 'submitted',
  SCHEDULED: 'scheduled',
  FINISHER: 'completed',
};

function mapStatus(treadfiStatus: string, orderData: Record<string, unknown>): string {
  const base = STATUS_MAP[treadfiStatus.toUpperCase()] || treadfiStatus.toLowerCase();

  if (base === 'completed' || base === 'canceled') {
    const gridSl = orderData.grid_stop_loss_triggered;
    const gridTp = orderData.grid_take_profit_triggered;
    const cancelReason = String(orderData.cancel_reason || '');

    if (gridSl || cancelReason.toLowerCase().includes('stop_loss')) return 'stop_loss';
    if (gridTp || cancelReason.toLowerCase().includes('take_profit')) return 'take_profit';
  }

  return base;
}

function log(msg: string, ...args: unknown[]) {
  console.log(`[Executor] ${msg}`, ...args);
}

export async function executeMm(
  decision: AIDecision,
  equity: number,
  accountName = 'Paradex',
  exchange = '',
): Promise<Record<string, unknown> | null> {
  if (decision.action !== 'market_make' || !decision.pair) return null;

  // Clamp parameters to hard limits, apply confidence weighting
  const confidence = typeof decision.confidence === 'number' ? Math.max(0.1, Math.min(1, decision.confidence)) : 1;
  const margin = Math.min((decision.margin || 0) * confidence, equity * MAX_POSITION_PCT);
  const leverage = Math.min(decision.leverage || 3, MAX_LEVERAGE);
  const duration = Math.min(decision.duration || 3600, MAX_MM_DURATION);
  let spreadBps = decision.spread_bps ?? 5;
  spreadBps = Math.max(-MAX_SPREAD_BPS, Math.min(MAX_SPREAD_BPS, spreadBps));

  if (margin < 5) return null;

  // Get mid price to calculate base_asset_qty (required by Tread API)
  let midPrice = 0;
  try {
    midPrice = (await treadApi.getMidPrice(decision.pair, accountName)) || 0;
  } catch (err) {
    console.warn('[Executor] Tread mid price failed, trying HL fallback:', err);
  }
  if (midPrice <= 0) {
    // Try Hyperliquid as fallback (direct server call, no proxy)
    try {
      const mids = await hyperliquidApi.getAllMids();
      const base = decision.pair.split('-')[0];
      midPrice = mids[base] || 0;
    } catch (err) {
      console.warn('[Executor] HL mid price fallback also failed:', err);
    }
  }
  if (midPrice <= 0) return null;

  // Target notional = margin * leverage * multiplier (from Tread's MM engine)
  // reverse_grid uses 10 cycles, all other modes use 20 cycles
  const refPrice = decision.reference_price || 'mid';
  const multiplier = refPrice === 'reverse_grid' ? 10 : 20;
  const targetNotional = margin * leverage * multiplier;

  // Base qty = targetNotional / currentPrice (per-side target for Tread's MM engine)
  let baseQtyRaw = targetNotional / midPrice;

  // Round based on price magnitude
  if (midPrice > 10000) baseQtyRaw = Math.round(baseQtyRaw * 100000) / 100000;
  else if (midPrice > 100) baseQtyRaw = Math.round(baseQtyRaw * 10000) / 10000;
  else baseQtyRaw = Math.round(baseQtyRaw * 100) / 100;
  if (baseQtyRaw <= 0) return null;

  log(`Notional calc: margin=$${margin} x lev=${leverage} x mult=${multiplier} = $${targetNotional.toFixed(0)} target | baseQty=${baseQtyRaw} @ $${midPrice.toFixed(2)}`);
  const baseQty = baseQtyRaw;

  // Build mm_params for write-ahead record
  const refPriceStr = refPrice;
  let signalName: string | undefined;
  if (refPriceStr === 'signal') {
    const base = decision.pair.replace(/-USD[T]?$/i, '');
    signalName = `#RSI_${base}-USDT@Binance`;
  }

  const mmParams = JSON.stringify({
    margin, leverage, duration,
    spread_bps: spreadBps,
    reference_price: refPriceStr,
    engine_passiveness: decision.engine_passiveness,
    alpha_tilt: decision.alpha_tilt,
    grid_take_profit_pct: decision.grid_take_profit_pct,
    account_name: accountName,
    entry_mid_price: midPrice,
    ...(signalName ? { signal_name: signalName } : {}),
  });

  // 1. Write-ahead: persist trade as 'pending' before submitting
  //    If this DB write fails, do NOT submit to the exchange (no orphaned trades).
  let pendingTrade;
  try {
    pendingTrade = repository.saveTrade({
      pair: decision.pair,
      side: 'mm',
      quantity: margin,
      price: midPrice,
      treadfi_id: null,
      status: 'pending',
      reasoning: decision.reasoning,
      mm_params: mmParams,
      account_name: accountName,
      exchange: exchange || null,
      source: 'treadmagotchi',
      submitted_at: Date.now(),
      timestamp: Date.now(),
    });
    dbCircuitBreaker.recordSuccess();
  } catch (err) {
    dbCircuitBreaker.recordFailure(err);
    console.error('[Executor] Write-ahead FAILED -- aborting trade submission:', err);
    return null;
  }

  try {
    // 2. Submit to Tread API
    log(`Submitting MM: pair=${decision.pair} margin=${margin} lev=${leverage} baseQty=${baseQty} midPrice=${midPrice} account=${accountName} exchange=${exchange}`);
    const response = await treadApi.submitMmOrder({
      pair: decision.pair,
      base_qty: baseQty,
      margin,
      duration,
      leverage,
      engine_passiveness: decision.engine_passiveness || 0.1,
      schedule_discretion: decision.schedule_discretion || 0.05,
      alpha_tilt: decision.alpha_tilt || 0,
      notes: decision.reasoning.slice(0, 500),
      account_name: accountName,
      exchange,
    });

    const multiOrderId = String(response.id || '');
    log(`MM order created: ${multiOrderId}`);

    // 3. Configure spread
    try {
      await treadApi.changeMmSpread({
        multi_order_id: multiOrderId,
        spread_bps: spreadBps,
        reference_price: refPriceStr,
        grid_stop_loss_percent: ['grid', 'reverse_grid', 'signal'].includes(refPriceStr) ? 10 : null,
        grid_take_profit_percent: ['grid', 'reverse_grid', 'signal'].includes(refPriceStr) ? (decision.grid_take_profit_pct ?? null) : null,
        signal_name: signalName,
      });
    } catch (e) {
      console.error(`[Executor] changeMmSpread FAILED for ${multiOrderId} -- bot running with DEFAULT params:`, e);
      sseEmitter.emit('error', {
        message: `Spread config failed for ${decision.pair} on ${accountName}. Bot running with defaults.`,
      });
      repository.saveActivity({
        timestamp: Date.now(),
        category: 'error',
        action: 'spread_config_failed',
        pair: decision.pair,
        detail: JSON.stringify({ orderId: multiOrderId, error: e instanceof Error ? e.message : String(e) }),
      });
    }

    // 4. Confirm: update trade status to 'submitted' and attach treadfi_id
    if (pendingTrade.id != null) {
      repository.updateTradeStatus(pendingTrade.id, 'submitted', multiOrderId);
    }

    // Register with order monitor for stale detection
    orderMonitor.track(multiOrderId, decision.pair, accountName, midPrice);

    // Emit SSE event for trade submission
    sseEmitter.emit('bot_synced', {
      action: 'submitted',
      pair: decision.pair,
      account: accountName,
      treadfi_id: multiOrderId,
      margin,
      leverage,
      midPrice,
    });

    return response;
  } catch (err) {
    console.error(`[Executor] submitMmOrder FAILED:`, err);

    // Mark write-ahead trade as failed
    if (pendingTrade.id != null) {
      repository.updateTradeStatus(pendingTrade.id, 'failed');
    }

    return null;
  }
}

export async function syncBotStatuses(): Promise<Array<Record<string, unknown>>> {
  const updated: Array<Record<string, unknown>> = [];

  const trades = repository.getTrades(200);
  const pendingTrades = trades.filter(
    (t) => t.treadfi_id && ['submitted', 'active'].includes(t.status),
  );

  if (!pendingTrades.length) return updated;

  let orders: Array<Record<string, unknown>> = [];
  try {
    const data = await treadApi.getMmOrders('ACTIVE,COMPLETED,CANCELED,PAUSED,FAILED', 50);
    const raw = (data.market_maker_orders || data.multi_orders || data.results || data.orders || []) as Array<Record<string, unknown>>;
    orders = Array.isArray(raw) ? raw : [];
  } catch (err) {
    console.error('[Executor] Failed to fetch MM orders for sync:', err);
    sseEmitter.emit('error', { message: 'Failed to fetch bot statuses from Tread API' });
    return updated;
  }

  const orderMap = new Map(orders.map((o) => [String(o.id || ''), o]));

  for (const trade of pendingTrades) {
    const order = orderMap.get(trade.treadfi_id!);
    if (!order) continue;

    const newStatus = mapStatus(String(order.status || ''), order);
    if (newStatus === trade.status) continue;

    if (trade.id != null) {
      try {
        repository.updateTradeStatus(trade.id, newStatus);
        dbCircuitBreaker.recordSuccess();
      } catch (err) {
        dbCircuitBreaker.recordFailure(err);
        continue; // Skip this trade -- DB is unhealthy
      }
    }

    if (['completed', 'stop_loss', 'take_profit', 'canceled', 'failed'].includes(newStatus)) {
      let pnl = 0;
      // Priority: on_complete_stats.net_pnl > order.realized_pnl > -fee_notional
      try {
        const fullOrder = await treadApi.getMultiOrder(trade.treadfi_id!);
        const onComplete = fullOrder.on_complete_stats as Record<string, unknown> | undefined;
        if (onComplete?.net_pnl != null) {
          pnl = Number(onComplete.net_pnl);
        } else if (fullOrder.realized_pnl != null) {
          pnl = Number(fullOrder.realized_pnl);
        } else if (order.realized_pnl != null || order.pnl != null) {
          pnl = Number(order.realized_pnl ?? order.pnl ?? 0);
        } else {
          // Last resort: fetch TCA for fee as minimum cost
          const tca = await treadApi.getMultiOrderTca(trade.treadfi_id!);
          pnl = -Number(tca.fee_notional || 0);
        }
      } catch (err) {
        console.error('[Executor] PnL reconciliation failed for', trade.treadfi_id, err);
        pnl = Number(order.realized_pnl || order.pnl || NaN);
      }

      // Use actual executed_notional from Tread API (real filled volume)
      const volume = Number(order.executed_notional || 0);
      const pnlUncertain = isNaN(pnl);
      if (pnlUncertain) {
        console.error(`[Executor] PnL UNKNOWN for ${trade.treadfi_id} -- skipping outcome, needs manual reconciliation`);
        sseEmitter.emit('error', {
          message: `PnL unknown for completed bot ${trade.treadfi_id}. Manual reconciliation needed.`,
        });
        repository.saveActivity({
          timestamp: Date.now(),
          category: 'error',
          action: 'pnl_unknown',
          pair: trade.pair,
          detail: JSON.stringify({ treadfi_id: trade.treadfi_id }),
        });
      } else {
        if (trade.id != null) repository.saveTradeOutcome(trade.id, pnl);
        if (pnl < 0) riskManager.recordLoss(Math.abs(pnl));
      }

      updated.push({ trade_id: trade.id, order_id: trade.treadfi_id, status: newStatus, pnl: pnlUncertain ? undefined : pnl, volume });

      // Emit SSE event for completed trade
      sseEmitter.emit('trade_completed', {
        pair: trade.pair,
        treadfi_id: trade.treadfi_id,
        status: newStatus,
        pnl: pnlUncertain ? null : pnl,
        volume,
      });
    } else {
      updated.push({ trade_id: trade.id, order_id: trade.treadfi_id, status: newStatus });

      // Emit SSE event for status change
      sseEmitter.emit('bot_synced', {
        action: 'status_change',
        pair: trade.pair,
        treadfi_id: trade.treadfi_id,
        status: newStatus,
      });
    }
  }

  return updated;
}
