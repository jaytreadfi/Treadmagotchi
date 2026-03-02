/**
 * Order Monitor -- detects stale orders and takes corrective action.
 * Adjusts spreads on drifted orders and cancels hopeless ones.
 *
 * Server-side port:
 *   - Uses globalThis pattern for HMR safety.
 *   - Bootstraps eagerly at engine start (not lazily).
 *   - Emits SSE events for spread adjustments and cancellations.
 *   - Uses server-side treadApi (direct HTTP, no proxy).
 *   - Persists activity to SQLite via repository.
 */
import {
  ORDER_MONITOR_START_MS,
  ORDER_SPREAD_ADJUST_MS,
  ORDER_CANCEL_MS,
  ORDER_DRIFT_THRESHOLD_PCT,
  ORDER_MIN_FILL_PCT,
} from '@/lib/constants';
import * as treadApi from '@/server/clients/treadApi';
import * as repository from '@/server/db/repository';
import { sseEmitter } from '@/server/engine/sseEmitter';

interface TrackedOrder {
  orderId: string;
  pair: string;
  accountName: string;
  entryMidPrice: number;
  submittedAt: number;
  spreadAdjusted: boolean;
  lastPctFilled: number;
}

function log(msg: string, ...args: unknown[]) {
  console.log(`[OrderMonitor] ${msg}`, ...args);
}

class OrderMonitor {
  private tracked = new Map<string, TrackedOrder>();

  /** Bootstrap tracker from DB -- called eagerly at engine start. */
  bootstrap(): void {
    this.tracked.clear();

    const activeTrades = repository.getActiveTradesOnly();

    for (const trade of activeTrades) {
      if (!trade.treadfi_id) continue;

      let params: Record<string, unknown> = {};
      try {
        params = typeof trade.mm_params === 'string'
          ? JSON.parse(trade.mm_params)
          : (trade.mm_params || {});
      } catch { /* skip */ }

      const entryMid = Number(params.entry_mid_price || trade.price || 0);
      if (entryMid <= 0) continue;

      this.tracked.set(trade.treadfi_id, {
        orderId: trade.treadfi_id,
        pair: trade.pair,
        accountName: String(params.account_name || 'Paradex'),
        entryMidPrice: entryMid,
        submittedAt: trade.timestamp,
        spreadAdjusted: false,
        lastPctFilled: 0,
      });
    }

    if (this.tracked.size > 0) {
      log(`Bootstrapped ${this.tracked.size} active orders from DB`);
    }
  }

  /** Register a newly submitted order for tracking */
  track(orderId: string, pair: string, accountName: string, entryMidPrice: number): void {
    this.tracked.set(orderId, {
      orderId,
      pair,
      accountName,
      entryMidPrice,
      submittedAt: Date.now(),
      spreadAdjusted: false,
      lastPctFilled: 0,
    });
    log(`Tracking order ${orderId} (${pair} @ $${entryMidPrice.toFixed(2)})`);
  }

  /** Remove an order from tracking (completed/canceled) */
  untrack(orderId: string): void {
    this.tracked.delete(orderId);
  }

  /**
   * Main check loop -- called from sync every 30s.
   * @param activeOrders - already-fetched active orders from the API to avoid duplicate calls
   */
  async checkOrders(activeOrders: Array<Record<string, unknown>>): Promise<void> {
    if (this.tracked.size === 0) return;

    const now = Date.now();
    const activeOrderMap = new Map(
      activeOrders.map((o) => [String(o.id || ''), o]),
    );

    // Clean up tracked orders that are no longer active
    for (const [id] of this.tracked) {
      if (!activeOrderMap.has(id)) {
        this.tracked.delete(id);
      }
    }

    for (const [id, order] of this.tracked) {
      const age = now - order.submittedAt;

      // No monitoring before 5 min
      if (age < ORDER_MONITOR_START_MS) continue;

      const apiOrder = activeOrderMap.get(id);
      const pctFilled = apiOrder ? Number(apiOrder.pct_filled ?? apiOrder.percent_filled ?? 0) : order.lastPctFilled;
      order.lastPctFilled = pctFilled;

      // Fetch current mid price to calculate drift
      let currentMid = 0;
      try {
        currentMid = (await treadApi.getMidPrice(order.pair, order.accountName)) || 0;
      } catch { /* skip this order */ }
      if (currentMid <= 0) continue;

      const drift = Math.abs(currentMid - order.entryMidPrice) / order.entryMidPrice;

      // >= 30 min: cancel if barely filled and drifted
      if (age >= ORDER_CANCEL_MS) {
        if (pctFilled < ORDER_MIN_FILL_PCT && drift > ORDER_DRIFT_THRESHOLD_PCT) {
          const cancelMsg = `CANCEL ${id} (${order.pair}): age=${(age / 60000).toFixed(0)}m, filled=${pctFilled.toFixed(1)}%, drift=${(drift * 100).toFixed(2)}%`;
          log(cancelMsg);
          repository.saveActivity({
            timestamp: Date.now(),
            category: 'monitor',
            action: 'cancel_stale',
            pair: order.pair,
            detail: JSON.stringify({ orderId: id, account: order.accountName, ageMin: +(age / 60000).toFixed(0), pctFilled, driftPct: +(drift * 100).toFixed(2) }),
          });
          sseEmitter.emit('activity_logged', {
            action: 'cancel_stale',
            orderId: id,
            pair: order.pair,
            account: order.accountName,
            ageMin: +(age / 60000).toFixed(0),
            pctFilled,
            driftPct: +(drift * 100).toFixed(2),
          });
          try {
            await treadApi.cancelMultiOrder(id);
            this.tracked.delete(id);
          } catch (e) {
            console.error(`[OrderMonitor] Cancel failed for ${id}:`, e);
          }
          continue;
        }
        // >= 20% filled -- let it run, it's making progress
        if (pctFilled >= ORDER_MIN_FILL_PCT) continue;
      }

      // >= 15 min: adjust spread to 0 if drifted and not already adjusted
      if (age >= ORDER_SPREAD_ADJUST_MS && drift > ORDER_DRIFT_THRESHOLD_PCT && !order.spreadAdjusted) {
        log(
          `SPREAD->0 ${id} (${order.pair}): age=${(age / 60000).toFixed(0)}m, ` +
          `drift=${(drift * 100).toFixed(2)}%`,
        );
        repository.saveActivity({
          timestamp: Date.now(),
          category: 'monitor',
          action: 'spread_adjust',
          pair: order.pair,
          detail: JSON.stringify({ orderId: id, account: order.accountName, ageMin: +(age / 60000).toFixed(0), driftPct: +(drift * 100).toFixed(2), newSpread: 0 }),
        });
        sseEmitter.emit('activity_logged', {
          action: 'spread_adjust',
          orderId: id,
          pair: order.pair,
          account: order.accountName,
          ageMin: +(age / 60000).toFixed(0),
          driftPct: +(drift * 100).toFixed(2),
          newSpread: 0,
        });
        try {
          await treadApi.changeMmSpread({
            multi_order_id: id,
            spread_bps: 0,
            reference_price: 'mid',
          });
          order.spreadAdjusted = true;
        } catch (e) {
          console.error(`[OrderMonitor] Spread adjust failed for ${id}:`, e);
        }
        continue;
      }

      // 5-15 min: log warning only
      if (drift > ORDER_DRIFT_THRESHOLD_PCT) {
        log(
          `DRIFT WARNING ${id} (${order.pair}): age=${(age / 60000).toFixed(0)}m, ` +
          `drift=${(drift * 100).toFixed(2)}%, filled=${pctFilled.toFixed(1)}%`,
        );
        repository.saveActivity({
          timestamp: Date.now(),
          category: 'monitor',
          action: 'drift_warning',
          pair: order.pair,
          detail: JSON.stringify({ orderId: id, account: order.accountName, ageMin: +(age / 60000).toFixed(0), driftPct: +(drift * 100).toFixed(2), pctFilled }),
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// globalThis singleton -- survives HMR reloads in development
// ---------------------------------------------------------------------------

const GLOBAL_KEY = '__treadmagotchi_order_monitor__';

function getOrCreateOrderMonitor(): OrderMonitor {
  const g = globalThis as unknown as Record<string, OrderMonitor | undefined>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new OrderMonitor();
  }
  return g[GLOBAL_KEY]!;
}

export const orderMonitor = getOrCreateOrderMonitor();
