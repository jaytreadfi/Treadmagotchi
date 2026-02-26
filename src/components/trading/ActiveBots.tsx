'use client';

import { useState, useEffect } from 'react';
import * as treadApi from '@/clients/treadApi';
import { treadfiToPair } from '@/lib/constants';

interface BotInfo {
  id: string;
  pair: string;
  status: string;
  margin: number;
}

export default function ActiveBots() {
  const [bots, setBots] = useState<BotInfo[]>([]);

  useEffect(() => {
    const fetchBots = async () => {
      try {
        const raw = await treadApi.getActiveMmBots();
        const mapped = raw.map((bot) => {
          const childOrders = (bot.child_orders || []) as Array<Record<string, unknown>>;
          const pair = childOrders.length
            ? treadfiToPair(String(childOrders[0].pair || ''))
            : 'Unknown';
          return {
            id: String(bot.id || '').slice(0, 8),
            pair,
            status: String(bot.status || 'ACTIVE'),
            margin: Number(bot.margin || 0),
          };
        });
        setBots(mapped);
      } catch {
        // silent
      }
    };

    fetchBots();
    const interval = setInterval(fetchBots, 30_000);
    return () => clearInterval(interval);
  }, []);

  if (!bots.length) {
    return (
      <div className="text-center text-[8px] opacity-30 py-2">
        No active bots
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {bots.map((bot) => (
        <div
          key={bot.id}
          className="flex items-center justify-between px-2 py-1 bg-pixel-dark/50 rounded text-[7px]"
        >
          <span className="text-pixel-blue">{bot.pair}</span>
          <span className="opacity-50">${bot.margin.toFixed(0)}</span>
          <span className="text-pixel-green">{bot.status}</span>
        </div>
      ))}
    </div>
  );
}
