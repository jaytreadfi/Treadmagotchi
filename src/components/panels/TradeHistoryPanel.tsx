'use client';

import { useRef, useCallback, useState } from 'react';
import { useTradeHistory } from '@/hooks/useTradeHistory';
import TradeRow from './TradeRow';

export default function TradeHistoryPanel() {
  const { trades, loading, hasMore, loadMore } = useTradeHistory();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expandedId, setExpandedId] = useState<number | string | null>(null);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !hasMore || loading) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 20) {
      loadMore();
    }
  }, [hasMore, loading, loadMore]);

  const toggleExpand = (id: number | string | undefined) => {
    if (id == null) return;
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="p-5 flex flex-col h-full">
      <h3 className="text-sm text-gold uppercase mb-4">Trade Log</h3>
      <div className="grid grid-cols-[1fr_0.8fr_0.7fr_0.7fr_0.6fr_0.6fr] gap-2 text-[10px] text-white/30 uppercase pb-2 border-b border-gold-dim/20">
        <span>Pair</span>
        <span>Account</span>
        <span className="text-right">Volume</span>
        <span className="text-right">PnL</span>
        <span className="text-center">Strategy</span>
        <span className="text-right">Status</span>
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto min-h-0"
      >
        {trades.length === 0 && !loading && (
          <div className="text-sm text-white/20 text-center py-8">
            No trades yet
          </div>
        )}
        {trades.map((trade, i) => (
          <TradeRow
            key={trade.id ?? i}
            trade={trade}
            isNew={i === 0}
            expanded={expandedId === (trade.id ?? i)}
            onToggle={() => toggleExpand(trade.id ?? i)}
          />
        ))}
        {loading && (
          <div className="text-sm text-white/30 text-center py-4">Loading...</div>
        )}
      </div>
    </div>
  );
}
