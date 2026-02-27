'use client';

import { useState, useEffect } from 'react';
import * as treadApi from '@/clients/treadApi';
import { treadfiToPair } from '@/lib/constants';

interface BotInfo {
  id: string;
  pair: string;
  exchange: string;
  status: string;
  margin: number;
  leverage: number;
  spreadBps: number | null;
  refPrice: string;
  volume: number;
  fees: number;
  pctFilled: number;
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
          const accountNames = (bot.account_names || []) as string[];
          return {
            id: String(bot.id || '').slice(0, 8),
            pair,
            exchange: accountNames[0] || '?',
            status: String(bot.status || 'ACTIVE'),
            margin: Number(bot.margin || 0),
            leverage: Number(bot.leverage || 1),
            spreadBps: bot.spread_bps != null ? Number(bot.spread_bps) : null,
            refPrice: String(bot.reference_price_type || 'mid'),
            volume: Number(bot.executed_notional || 0),
            fees: Number(bot.fee_notional || 0),
            pctFilled: Number(bot.pct_filled || 0),
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
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-7 gap-1 px-2 text-[6px] opacity-40">
        <span>PAIR</span>
        <span>ACCT</span>
        <span>MODE</span>
        <span>LEV</span>
        <span>MARGIN</span>
        <span>VOL</span>
        <span>FEES</span>
      </div>
      {bots.map((bot) => (
        <div
          key={bot.id}
          className="grid grid-cols-7 gap-1 px-2 py-1.5 bg-pixel-dark/50 rounded text-[7px] items-center"
        >
          <span className="text-pixel-blue truncate">{bot.pair}</span>
          <span className="opacity-60 truncate">{bot.exchange}</span>
          <span className="text-pixel-yellow">
            {bot.refPrice === 'grid' ? 'GRD' : bot.refPrice === 'reverse_grid' ? 'RGD' : 'MID'}
            {bot.spreadBps != null ? ` ${bot.spreadBps > 0 ? '+' : ''}${bot.spreadBps}` : ''}
          </span>
          <span className="opacity-70">{bot.leverage}x</span>
          <span className="opacity-70">${bot.margin.toFixed(0)}</span>
          <span className="text-pixel-green">
            {bot.volume >= 1000 ? `$${(bot.volume / 1000).toFixed(1)}K` : `$${bot.volume.toFixed(0)}`}
          </span>
          <span className="text-pixel-red opacity-70">
            ${bot.fees.toFixed(3)}
          </span>
        </div>
      ))}
    </div>
  );
}
