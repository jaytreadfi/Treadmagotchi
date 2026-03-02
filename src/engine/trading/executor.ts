/**
 * Executor — ported from treadbot/backend/app/trading/executor.py.
 * Validates, submits, and syncs MM bots via Tread API.
 */
import {
  MAX_LEVERAGE, MAX_MM_DURATION, MAX_POSITION_PCT, MAX_SPREAD_BPS,
} from '@/lib/constants';
import { treadfiToPair } from '@/lib/constants';
import type { AIDecision } from '@/lib/types';
import * as treadApi from '@/clients/treadApi';
import * as db from '@/persistence/db';
import { riskManager } from './riskManager';
import { orderMonitor } from './orderMonitor';

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
  } catch { /* fallback below */ }
  if (midPrice <= 0) {
    // Try Hyperliquid as fallback
    try {
      const hlRes = await fetch('/api/proxy/hyperliquid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'allMids' }),
      });
      const mids = await hlRes.json() as Record<string, string>;
      const base = decision.pair.split('-')[0];
      midPrice = parseFloat(mids[base] || '0');
    } catch { /* give up */ }
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

  console.log(`[Executor] Notional calc: margin=$${margin} × lev=${leverage} × mult=${multiplier} = $${targetNotional.toFixed(0)} target | baseQty=${baseQtyRaw} @ $${midPrice.toFixed(2)}`);
  const baseQty = baseQtyRaw;

  try {
    console.log(`[Executor] Submitting MM: pair=${decision.pair} margin=${margin} lev=${leverage} baseQty=${baseQty} midPrice=${midPrice} account=${accountName} exchange=${exchange}`);
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
    console.log(`[Executor] MM order created: ${multiOrderId}`);

    // Apply spread config (refPrice already set above for multiplier calc)
    const applySpread = spreadBps;

    // Build signal_name for RSI signal mode: #RSI_<BASE>-USDT@<exchange>
    let signalName: string | undefined;
    if (refPrice === 'signal') {
      const base = decision.pair.replace(/-USD[T]?$/i, '');
      signalName = `#RSI_${base}-USDT@Binance`;
    }

    try {
      await treadApi.changeMmSpread({
        multi_order_id: multiOrderId,
        spread_bps: applySpread,
        reference_price: refPrice,
        grid_stop_loss_percent: ['grid', 'reverse_grid', 'signal'].includes(refPrice) ? 10 : null,
        grid_take_profit_percent: ['grid', 'reverse_grid', 'signal'].includes(refPrice) ? (decision.grid_take_profit_pct ?? null) : null,
        signal_name: signalName,
      });
    } catch (e) {
      console.error(`[Executor] changeMmSpread failed (non-fatal):`, e);
    }

    // Record in DB
    await db.saveTrade({
      pair: decision.pair,
      side: 'mm',
      quantity: margin,
      price: midPrice,
      treadfi_id: multiOrderId,
      status: 'submitted',
      reasoning: decision.reasoning,
      mm_params: JSON.stringify({
        margin, leverage, duration,
        spread_bps: spreadBps,
        reference_price: refPrice,
        engine_passiveness: decision.engine_passiveness,
        alpha_tilt: decision.alpha_tilt,
        grid_take_profit_pct: decision.grid_take_profit_pct,
        account_name: accountName,
        entry_mid_price: midPrice,
        ...(signalName ? { signal_name: signalName } : {}),
      }),
      source: 'treadmagotchi',
      timestamp: Date.now(),
    });

    // Register with order monitor for stale detection
    orderMonitor.track(multiOrderId, decision.pair, accountName, midPrice);

    return response;
  } catch (err) {
    console.error(`[Executor] submitMmOrder FAILED:`, err);
    return null;
  }
}

export async function syncBotStatuses(): Promise<Array<Record<string, unknown>>> {
  const updated: Array<Record<string, unknown>> = [];

  const trades = await db.getTrades(200);
  const pendingTrades = trades.filter(
    (t) => t.treadfi_id && ['submitted', 'active'].includes(t.status),
  );

  if (!pendingTrades.length) return updated;

  let orders: Array<Record<string, unknown>> = [];
  try {
    const data = await treadApi.getMmOrders('ACTIVE,COMPLETED,CANCELED,PAUSED,FAILED', 50);
    const raw = (data.market_maker_orders || data.multi_orders || data.results || data.orders || []) as Array<Record<string, unknown>>;
    orders = Array.isArray(raw) ? raw : [];
  } catch {
    return updated;
  }

  const orderMap = new Map(orders.map((o) => [String(o.id || ''), o]));

  for (const trade of pendingTrades) {
    const order = orderMap.get(trade.treadfi_id);
    if (!order) continue;

    const newStatus = mapStatus(String(order.status || ''), order);
    if (newStatus === trade.status) continue;

    if (trade.id != null) await db.updateTradeStatus(trade.id, newStatus);

    if (['completed', 'stop_loss', 'take_profit', 'canceled', 'failed'].includes(newStatus)) {
      let pnl = 0;
      // Priority: on_complete_stats.net_pnl > order.realized_pnl > -fee_notional
      try {
        const fullOrder = await treadApi.getMultiOrder(trade.treadfi_id);
        const onComplete = fullOrder.on_complete_stats as Record<string, unknown> | undefined;
        if (onComplete?.net_pnl != null) {
          pnl = Number(onComplete.net_pnl);
        } else if (fullOrder.realized_pnl != null) {
          pnl = Number(fullOrder.realized_pnl);
        } else if (order.realized_pnl != null || order.pnl != null) {
          pnl = Number(order.realized_pnl ?? order.pnl ?? 0);
        } else {
          // Last resort: fetch TCA for fee as minimum cost
          const tca = await treadApi.getMultiOrderTca(trade.treadfi_id);
          pnl = -Number(tca.fee_notional || 0);
        }
      } catch {
        pnl = Number(order.realized_pnl || order.pnl || 0);
      }

      // Use actual executed_notional from Tread API (real filled volume)
      const volume = Number(order.executed_notional || 0);

      if (trade.id != null) await db.saveTradeOutcome(trade.id, pnl);
      if (pnl < 0) riskManager.recordLoss(Math.abs(pnl));

      updated.push({ trade_id: trade.id, order_id: trade.treadfi_id, status: newStatus, pnl, volume });
    } else {
      updated.push({ trade_id: trade.id, order_id: trade.treadfi_id, status: newStatus });
    }
  }

  return updated;
}
