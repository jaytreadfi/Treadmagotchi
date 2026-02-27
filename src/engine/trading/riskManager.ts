/**
 * RiskManager — ported from treadbot/backend/app/trading/risk.py.
 * Enforces hard-coded limits. Runs entirely client-side.
 */
import {
  MAX_POSITION_PCT, MAX_TOTAL_EXPOSURE_PCT, MAX_DAILY_LOSS_USD, MAX_DAILY_LOSS_PCT,
  MAX_DRAWDOWN_PCT, STOP_LOSS_PCT,
} from '@/lib/constants';
import type { Position, RiskMetrics } from '@/lib/types';

class RiskManager {
  private pnlHistory: number[] = [];
  private peakEquity: number;
  private dailyLosses: Map<string, number> = new Map();

  constructor(initialCapital = 100) {
    this.peakEquity = initialCapital;
  }

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
    // Exposure cap removed — leverage inflates notional exposure far beyond equity,
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
    this.dailyLosses.set(today, (this.dailyLosses.get(today) || 0) + loss);
    // Cleanup old entries
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    for (const [date] of this.dailyLosses) {
      if (date < cutoffStr) this.dailyLosses.delete(date);
    }
  }

  seedFromDb(peakEquity: number, dailyLoss: number): void {
    if (peakEquity > 0) this.peakEquity = Math.max(this.peakEquity, peakEquity);
    if (dailyLoss > 0) {
      const today = new Date().toISOString().split('T')[0];
      this.dailyLosses.set(today, (this.dailyLosses.get(today) || 0) + dailyLoss);
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

export const riskManager = new RiskManager();
