/**
 * RiskManager -- server-side port.
 *
 * Uses globalThis pattern for HMR safety (Vite/Next dev restarts
 * re-import modules but globalThis survives).
 *
 * Persistence:
 *   - peakEquity  -> repository.updateRiskState() / getRiskState()
 *   - dailyLosses -> repository.setDailyLoss()   / getDailyLoss()
 *   - pnlHistory  -> derived from pnl_snapshots table at startup
 *
 * All SQLite calls are synchronous (better-sqlite3). No async I/O is
 * wrapped in transactions.
 */
import {
  MAX_POSITION_PCT, MAX_TOTAL_EXPOSURE_PCT, MAX_DAILY_LOSS_USD, MAX_DAILY_LOSS_PCT,
  MAX_DRAWDOWN_PCT, STOP_LOSS_PCT,
} from '@/lib/constants';
import type { Position, RiskMetrics } from '@/lib/types';
import * as repository from '@/server/db/repository';
import * as configStore from '@/server/db/configStore';

// ---------------------------------------------------------------------------
// The class is instantiated once and stored on globalThis.
// ---------------------------------------------------------------------------

class RiskManager {
  private pnlHistory: number[] = [];
  private peakEquity: number;
  private dailyLosses: Map<string, number> = new Map();

  constructor(initialCapital = 100) {
    this.peakEquity = initialCapital;
  }

  // -----------------------------------------------------------------------
  // Seed from DB -- IDEMPOTENT.  Always uses .set(), never +=.
  // Must be called once at engine startup.
  // -----------------------------------------------------------------------

  seedFromDb(): void {
    // Peak equity from risk_state table
    const riskRow = repository.getRiskState();
    if (riskRow && riskRow.peak_equity > 0) {
      this.peakEquity = riskRow.peak_equity;
    } else {
      // Fall back to configured initial capital
      const capital = configStore.getConfig<number>('initial_capital') ?? 100;
      this.peakEquity = capital;
    }

    // Daily loss from daily_losses table -- .set() for idempotency
    const today = new Date().toISOString().split('T')[0];
    const todayLoss = repository.getDailyLoss(today);
    this.dailyLosses.set(today, todayLoss);

    // Derive pnlHistory from pnl_snapshots (most recent 1000 equity values)
    const snapshots = repository.getPnlSnapshots(1000);
    // Snapshots come descending; we want ascending for Sharpe calc
    this.pnlHistory = snapshots.reverse().map((s) => s.equity);
  }

  // -----------------------------------------------------------------------
  // Core risk calculation
  // -----------------------------------------------------------------------

  calculateMetrics(balance: number, positions: Position[], realizedPnl = 0): RiskMetrics {
    let totalExposure = 0;
    let unrealizedPnl = 0;
    let largestPosition = 0;

    for (const pos of positions) {
      const value = Math.abs(pos.size) * pos.mark_price;
      totalExposure += value;
      unrealizedPnl += pos.unrealized_pnl;
      largestPosition = Math.max(largestPosition, value);
    }

    const equity = balance + unrealizedPnl;
    this.peakEquity = Math.max(this.peakEquity, equity);
    const drawdown = this.peakEquity - equity;
    const drawdownPct = this.peakEquity > 0 ? drawdown / this.peakEquity : 0;

    const exposurePct = equity > 0 ? totalExposure / equity : 0;
    const largestPct = equity > 0 ? largestPosition / equity : 0;

    const { canTrade, message } = this.checkLimits(exposurePct, drawdownPct);

    // Persist updated peak equity (synchronous SQLite)
    repository.updateRiskState(this.peakEquity);

    return {
      total_exposure: totalExposure,
      exposure_pct: exposurePct,
      largest_position: largestPosition,
      largest_position_pct: largestPct,
      num_positions: positions.length,
      unrealized_pnl: unrealizedPnl,
      realized_pnl: realizedPnl,
      drawdown,
      drawdown_pct: drawdownPct,
      sharpe_ratio: this.sharpe(),
      can_trade: canTrade,
      risk_message: message,
      daily_loss: this.getDailyLoss(),
    };
  }

  private checkLimits(exposurePct: number, drawdownPct: number): { canTrade: boolean; message: string } {
    if (drawdownPct >= MAX_DRAWDOWN_PCT) {
      return { canTrade: false, message: `Max drawdown ${(drawdownPct * 100).toFixed(1)}% >= ${MAX_DRAWDOWN_PCT * 100}%` };
    }
    // Exposure cap removed -- leverage inflates notional exposure far beyond equity,
    // which is expected for leveraged MM bots. Margin-per-trade cap still applies.
    const daily = this.getDailyLoss();
    // Adaptive daily loss: max(fixed $10, 5% of peak equity)
    const equityBasedLimit = this.peakEquity * MAX_DAILY_LOSS_PCT;
    const effectiveLimit = Math.max(MAX_DAILY_LOSS_USD, equityBasedLimit);
    if (daily >= effectiveLimit) {
      return { canTrade: false, message: `Daily loss $${daily.toFixed(2)} >= $${effectiveLimit.toFixed(2)} (${(MAX_DAILY_LOSS_PCT * 100).toFixed(0)}% of peak equity)` };
    }
    return { canTrade: true, message: 'OK' };
  }

  maxMargin(equity: number): number {
    return equity * MAX_POSITION_PCT;
  }

  availableMargin(equity: number, currentExposure: number): number {
    const maxTotal = equity * MAX_TOTAL_EXPOSURE_PCT;
    return Math.max(0, Math.min(this.maxMargin(equity), maxTotal - currentExposure));
  }

  checkStopLoss(pos: Position): boolean {
    if (pos.entry_price <= 0) return false;
    const pctChange = pos.side === 'buy'
      ? (pos.mark_price - pos.entry_price) / pos.entry_price
      : (pos.entry_price - pos.mark_price) / pos.entry_price;
    return pctChange <= -STOP_LOSS_PCT;
  }

  getDailyLoss(): number {
    const today = new Date().toISOString().split('T')[0];
    return this.dailyLosses.get(today) || 0;
  }

  recordLoss(loss: number): void {
    if (loss <= 0) return;
    const today = new Date().toISOString().split('T')[0];
    const newTotal = (this.dailyLosses.get(today) || 0) + loss;
    this.dailyLosses.set(today, newTotal);

    // Persist to SQLite (synchronous)
    repository.setDailyLoss(today, newTotal);

    // Cleanup old in-memory entries
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    for (const [date] of this.dailyLosses) {
      if (date < cutoffStr) this.dailyLosses.delete(date);
    }
  }

  updatePnlHistory(equity: number): void {
    this.pnlHistory.push(equity);
    if (this.pnlHistory.length > 1000) {
      this.pnlHistory = this.pnlHistory.slice(-1000);
    }
  }

  private sharpe(): number {
    if (this.pnlHistory.length < 2) return 0;
    const returns: number[] = [];
    for (let i = 1; i < this.pnlHistory.length; i++) {
      const prev = this.pnlHistory[i - 1];
      if (prev !== 0) returns.push((this.pnlHistory[i] - prev) / Math.abs(prev));
    }
    if (returns.length < 2) return 0;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
    const std = Math.sqrt(variance);
    return std > 0 ? mean / std : 0;
  }
}

// ---------------------------------------------------------------------------
// globalThis singleton -- survives HMR reloads in development
// ---------------------------------------------------------------------------

const GLOBAL_KEY = '__treadmagotchi_risk_manager__';

function getOrCreateRiskManager(): RiskManager {
  const g = globalThis as unknown as Record<string, RiskManager | undefined>;
  if (!g[GLOBAL_KEY]) {
    const capital = configStore.getConfig<number>('initial_capital') ?? 100;
    g[GLOBAL_KEY] = new RiskManager(capital);
  }
  return g[GLOBAL_KEY]!;
}

export const riskManager = getOrCreateRiskManager();
