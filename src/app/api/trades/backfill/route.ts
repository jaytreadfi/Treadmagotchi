/**
 * POST /api/trades/backfill
 *
 * One-time backfill: re-fetches all trades with treadfi_id from the Tread API
 * and corrects status, volume, mm_params, and PnL in the local DB.
 */
import { NextResponse } from 'next/server';
import { withAuth } from '@/server/middleware/auth';
import * as repository from '@/server/db/repository';
import * as treadApi from '@/server/clients/treadApi';

export const dynamic = 'force-dynamic';

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

export const POST = withAuth(async () => {
  const trades = repository.getTradesWithTreadfiId(500);
  const results = { updated: 0, errors: 0, skipped: 0 };

  for (const trade of trades) {
    if (!trade.treadfi_id) { results.skipped++; continue; }

    try {
      const fullOrder = await treadApi.getMultiOrder(trade.treadfi_id);

      // 1. Fix status
      const apiStatus = String(fullOrder.status || '');
      if (apiStatus) {
        const correctStatus = mapStatus(apiStatus, fullOrder);
        if (correctStatus !== trade.status) {
          repository.updateTradeStatus(trade.id, correctStatus);
        }
      }

      // 2. Fix volume
      const volume = Number(fullOrder.executed_notional || 0);
      const extras: { volume?: number; mm_params?: string; quantity?: number } = {};
      if (volume > 0) extras.volume = volume;

      // 3. Fix mm_params (strategy)
      if (!trade.mm_params || trade.mm_params === '{}') {
        const enriched: Record<string, unknown> = {};
        if (fullOrder.reference_price != null) enriched.reference_price = fullOrder.reference_price;
        if (fullOrder.spread_bps != null) enriched.spread_bps = Number(fullOrder.spread_bps);
        if (fullOrder.leverage != null) enriched.leverage = Number(fullOrder.leverage);
        if (fullOrder.margin != null) enriched.margin = Number(fullOrder.margin);
        if (fullOrder.engine_passiveness != null) enriched.engine_passiveness = fullOrder.engine_passiveness;
        if (Object.keys(enriched).length > 0) extras.mm_params = JSON.stringify(enriched);
      }

      // 4. Fix quantity (margin) if it was 0
      const margin = Number(fullOrder.margin || 0);
      if (trade.quantity === 0 && margin > 0) extras.quantity = margin;

      if (Object.keys(extras).length > 0) {
        repository.updateTradeExtras(trade.id, extras);
      }

      // 5. Fix PnL
      let pnl = NaN;
      const onComplete = fullOrder.on_complete_stats as Record<string, unknown> | undefined;
      if (onComplete?.net_pnl != null) {
        pnl = Number(onComplete.net_pnl);
      } else if (fullOrder.realized_pnl != null) {
        pnl = Number(fullOrder.realized_pnl);
      } else {
        try {
          const tca = await treadApi.getMultiOrderTca(trade.treadfi_id);
          pnl = -Number(tca.fee_notional || 0);
        } catch { /* non-fatal */ }
      }

      if (!isNaN(pnl)) {
        repository.saveTradeOutcome(trade.id, pnl);
      }

      results.updated++;
    } catch (err) {
      console.error(`[backfill] Failed for ${trade.treadfi_id}:`, err);
      results.errors++;
    }
  }

  repository.saveActivity({
    timestamp: Date.now(),
    category: 'engine',
    action: 'backfill',
    pair: null,
    detail: JSON.stringify(results),
  });

  return NextResponse.json({ success: true, ...results, total: trades.length });
});
