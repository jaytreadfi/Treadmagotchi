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
): Promise<Record<string, unknown> | null> {
  if (decision.action !== 'market_make' || !decision.pair) return null;

  // Clamp parameters to hard limits
  const margin = Math.min(decision.margin || 0, equity * MAX_POSITION_PCT);
  const leverage = Math.min(decision.leverage || 3, MAX_LEVERAGE);
  const duration = Math.min(decision.duration || 3600, MAX_MM_DURATION);
  let spreadBps = decision.spread_bps ?? 5;
  spreadBps = Math.max(-MAX_SPREAD_BPS, Math.min(MAX_SPREAD_BPS, spreadBps));

  if (margin < 5) return null;

  try {
    // Submit with margin + leverage only. Tread calculates volume.
    const response = await treadApi.submitMmOrder({
      pair: decision.pair,
      margin,
      duration,
      leverage,
      engine_passiveness: decision.engine_passiveness || 0.1,
      schedule_discretion: decision.schedule_discretion || 0.05,
      alpha_tilt: decision.alpha_tilt || 0,
      notes: decision.reasoning.slice(0, 500),
      account_name: accountName,
    });

    const multiOrderId = String(response.id || '');

    // Apply spread config
    const refPrice = decision.reference_price || 'mid';
    const applySpread = spreadBps;
    try {
      await treadApi.changeMmSpread({
        multi_order_id: multiOrderId,
        spread_bps: applySpread,
        reference_price: refPrice,
        grid_stop_loss_percent: ['grid', 'reverse_grid'].includes(refPrice) ? 10 : null,
        grid_take_profit_percent: ['grid', 'reverse_grid'].includes(refPrice) ? (decision.grid_take_profit_pct ?? null) : null,
      });
    } catch {
      // non-fatal
    }

    // Record in DB
    await db.saveTrade({
      pair: decision.pair,
      side: 'mm',
      quantity: margin,
      price: null,
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
      }),
      source: 'treadmagotchi',
      timestamp: Date.now(),
    });

    return response;
  } catch {
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
      try {
        const tca = await treadApi.getMultiOrderTca(trade.treadfi_id);
        pnl = -Number(tca.fee_notional || 0);
      } catch {
        pnl = Number(order.realized_pnl || order.pnl || 0);
      }

      // Calculate volume from mm_params (margin * leverage * 2 for buy+sell sides)
      let volume = 0;
      try {
        const params = typeof trade.mm_params === 'string' ? JSON.parse(trade.mm_params) : trade.mm_params;
        const margin = Number(params?.margin || 0);
        const leverage = Number(params?.leverage || 1);
        volume = margin * leverage * 2; // both sides
      } catch {
        // fallback: use quantity as rough estimate
        volume = trade.quantity * 2;
      }

      if (trade.id != null) await db.saveTradeOutcome(trade.id, pnl);
      if (pnl < 0) riskManager.recordLoss(Math.abs(pnl));

      updated.push({ trade_id: trade.id, order_id: trade.treadfi_id, status: newStatus, pnl, volume });
    } else {
      updated.push({ trade_id: trade.id, order_id: trade.treadfi_id, status: newStatus });
    }
  }

  return updated;
}
