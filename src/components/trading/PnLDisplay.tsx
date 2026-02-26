'use client';

import { useTradingStore } from '@/store/useTradingStore';
import { usePetStore } from '@/store/usePetStore';

export default function PnLDisplay() {
  const account = useTradingStore((s) => s.account);
  const metrics = useTradingStore((s) => s.riskMetrics);
  const cumulativeVolume = usePetStore((s) => s.cumulative_volume);

  return (
    <div className="grid grid-cols-2 gap-2 text-[8px] px-2">
      <div className="bg-pixel-dark/50 rounded p-2">
        <div className="opacity-50 mb-1">Balance</div>
        <div className="text-pixel-green">
          ${account?.balance.toFixed(2) ?? '---'}
        </div>
      </div>
      <div className="bg-pixel-dark/50 rounded p-2">
        <div className="opacity-50 mb-1">Equity</div>
        <div className="text-pixel-green">
          ${account?.equity.toFixed(2) ?? '---'}
        </div>
      </div>
      <div className="bg-pixel-dark/50 rounded p-2">
        <div className="opacity-50 mb-1">Unrealized</div>
        <div className={account && account.unrealized_pnl >= 0 ? 'text-pixel-green' : 'text-pixel-red'}>
          {account ? `$${account.unrealized_pnl >= 0 ? '+' : ''}${account.unrealized_pnl.toFixed(2)}` : '---'}
        </div>
      </div>
      <div className="bg-pixel-dark/50 rounded p-2">
        <div className="opacity-50 mb-1">Volume</div>
        <div className="text-pixel-yellow">
          ${cumulativeVolume >= 1_000_000 ? `${(cumulativeVolume / 1_000_000).toFixed(1)}M` : cumulativeVolume >= 1_000 ? `${(cumulativeVolume / 1_000).toFixed(1)}K` : cumulativeVolume.toFixed(0)}
        </div>
      </div>
      {metrics && (
        <>
          <div className="bg-pixel-dark/50 rounded p-2">
            <div className="opacity-50 mb-1">Exposure</div>
            <div>{(metrics.exposure_pct * 100).toFixed(1)}%</div>
          </div>
          <div className="bg-pixel-dark/50 rounded p-2">
            <div className="opacity-50 mb-1">Drawdown</div>
            <div className={metrics.drawdown_pct > 0.1 ? 'text-pixel-red' : ''}>
              {(metrics.drawdown_pct * 100).toFixed(1)}%
            </div>
          </div>
        </>
      )}
    </div>
  );
}
