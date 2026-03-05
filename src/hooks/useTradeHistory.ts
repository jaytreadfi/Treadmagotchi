'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTradingStore } from '@/store/useTradingStore';
import type { TradeRecord } from '@/lib/types';

const PAGE_SIZE = 20;

export interface UseTradeHistoryReturn {
  trades: TradeRecord[];
  loading: boolean;
  hasMore: boolean;
  loadMore: () => void;
}

export function useTradeHistory(): UseTradeHistoryReturn {
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const cursorRef = useRef<number | null>(null);
  const cursorIdRef = useRef<number | null>(null);
  const tradeCompletedAt = useTradingStore((s) => s.tradeCompletedAt);
  const initialFetchDone = useRef(false);

  // Initial fetch
  useEffect(() => {
    if (initialFetchDone.current) return;
    initialFetchDone.current = true;

    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/trades?limit=${PAGE_SIZE}`);
        if (res.ok) {
          const data = await res.json();
          const fetched: TradeRecord[] = data.trades || [];
          setTrades(fetched);
          cursorRef.current = data.cursor;
          cursorIdRef.current = data.cursorId;
          setHasMore(fetched.length === PAGE_SIZE);
        }
      } catch { /* non-fatal */ }
      setLoading(false);
    })();
  }, []);

  // Live append on trade_completed SSE
  useEffect(() => {
    if (tradeCompletedAt === 0) return;

    (async () => {
      try {
        const res = await fetch(`/api/trades?limit=5`);
        if (res.ok) {
          const data = await res.json();
          const latest: TradeRecord[] = data.trades || [];

          setTrades((prev) => {
            const existingIds = new Set(prev.map((t) => t.id));
            const newTrades = latest.filter((t) => t.id && !existingIds.has(t.id));
            if (newTrades.length === 0) return prev;
            return [...newTrades, ...prev];
          });
        }
      } catch { /* non-fatal */ }
    })();
  }, [tradeCompletedAt]);

  const loadMore = useCallback(() => {
    if (loading || !hasMore) return;

    (async () => {
      setLoading(true);
      try {
        let url = `/api/trades?limit=${PAGE_SIZE}`;
        if (cursorRef.current != null) url += `&before=${cursorRef.current}`;
        if (cursorIdRef.current != null) url += `&beforeId=${cursorIdRef.current}`;

        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          const fetched: TradeRecord[] = data.trades || [];
          setTrades((prev) => [...prev, ...fetched]);
          cursorRef.current = data.cursor;
          cursorIdRef.current = data.cursorId;
          setHasMore(fetched.length === PAGE_SIZE);
        }
      } catch { /* non-fatal */ }
      setLoading(false);
    })();
  }, [loading, hasMore]);

  return { trades, loading, hasMore, loadMore };
}
