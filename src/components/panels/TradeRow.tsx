'use client';

import type { TradeRecord } from '@/lib/types';

interface TradeRowProps {
  trade: TradeRecord;
  isNew?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}

const STATUS_DISPLAY: Record<string, { label: string; color: string }> = {
  completed: { label: 'Filled', color: 'text-joy' },
  stop_loss: { label: 'Stop Loss', color: 'text-hp' },
  take_profit: { label: 'Take Profit', color: 'text-joy' },
  canceled: { label: 'Canceled', color: 'text-white/30' },
  failed: { label: 'Failed', color: 'text-hp' },
  active: { label: 'Active', color: 'text-energy' },
  submitted: { label: 'Pending', color: 'text-gold' },
  pending: { label: 'Pending', color: 'text-gold' },
};

const STRATEGY_DISPLAY: Record<string, string> = {
  mid: 'Mid',
  grid: 'Grid',
  reverse_grid: 'Rev Grid',
  signal: 'Signal',
};

function parseStrategy(mmParams: string): string {
  try {
    const parsed = JSON.parse(mmParams);
    return STRATEGY_DISPLAY[parsed.reference_price] || parsed.reference_price || '-';
  } catch {
    return '-';
  }
}

export default function TradeRow({ trade, isNew, expanded, onToggle }: TradeRowProps) {
  const status = STATUS_DISPLAY[trade.status] || { label: trade.status, color: 'text-white/30' };
  const strategy = parseStrategy(trade.mm_params);
  const pnl = trade.realized_pnl;
  const account = trade.account_name || '-';

  return (
    <div
      className={`border-b border-gold-dim/10 ${isNew ? 'animate-trade-in' : ''} ${onToggle ? 'cursor-pointer hover:bg-white/[0.02]' : ''}`}
      onClick={onToggle}
    >
      <div className="grid grid-cols-[1fr_0.8fr_0.7fr_0.7fr_0.6fr_0.6fr] gap-2 text-xs py-2">
        <span className="text-energy truncate">{trade.pair}</span>
        <span className="text-white/50 truncate">{account}</span>
        <span className="text-white/60 text-right">${trade.quantity.toFixed(0)}</span>
        <span className={`text-right ${pnl == null ? 'text-white/20' : pnl >= 0 ? 'text-joy' : 'text-hp'}`}>
          {pnl == null ? '-' : `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}`}
        </span>
        <span className="text-white/40 text-center">{strategy}</span>
        <span className={`${status.color} text-right truncate`}>{status.label}</span>
      </div>
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-in-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="px-2 pb-3 pt-1 text-[11px] text-white/40 italic leading-relaxed">
            &ldquo;{trade.reasoning}&rdquo;
          </div>
        </div>
      </div>
    </div>
  );
}
