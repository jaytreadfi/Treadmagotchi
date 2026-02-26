/**
 * IndexedDB persistence via Dexie — structured storage for trades, PnL, events.
 */
import Dexie, { type EntityTable } from 'dexie';
import type { TradeRecord, TradeOutcome, PnLSnapshot, PetEvent } from '@/lib/types';

const db = new Dexie('TreadmagotchiDB') as Dexie & {
  trades: EntityTable<TradeRecord, 'id'>;
  tradeOutcomes: EntityTable<TradeOutcome, 'id'>;
  pnlSnapshots: EntityTable<PnLSnapshot, 'id'>;
  events: EntityTable<PetEvent, 'id'>;
};

db.version(1).stores({
  trades: '++id, treadfi_id, pair, status, timestamp',
  tradeOutcomes: '++id, trade_id, timestamp',
  pnlSnapshots: '++id, timestamp',
  events: '++id, timestamp, type',
});

// ── Trade operations ──

export async function saveTrade(trade: Omit<TradeRecord, 'id'>): Promise<TradeRecord> {
  const id = await db.trades.add(trade as TradeRecord);
  return { ...trade, id: id as number };
}

export async function updateTradeStatus(id: number, status: string): Promise<void> {
  await db.trades.update(id, { status });
}

export async function updateTradeMmParams(id: number, mm_params: string): Promise<void> {
  await db.trades.update(id, { mm_params });
}

export async function getTrades(limit = 50): Promise<TradeRecord[]> {
  return db.trades.orderBy('timestamp').reverse().limit(limit).toArray();
}

export async function getAllTreadfiIds(): Promise<Set<string>> {
  const trades = await db.trades.toArray();
  return new Set(trades.map((t) => t.treadfi_id).filter(Boolean));
}

// ── Trade outcomes ──

export async function saveTradeOutcome(tradeId: number, pnl: number): Promise<void> {
  await db.tradeOutcomes.add({
    trade_id: tradeId,
    realized_pnl: pnl,
    outcome: pnl > 0.001 ? 'win' : pnl < -0.001 ? 'loss' : 'breakeven',
    timestamp: Date.now(),
  } as TradeOutcome);
}

export async function getTradeOutcomes(limit = 20): Promise<TradeOutcome[]> {
  return db.tradeOutcomes.orderBy('timestamp').reverse().limit(limit).toArray();
}

// ── PnL snapshots ──

export async function savePnlSnapshot(snapshot: Omit<PnLSnapshot, 'id'>): Promise<void> {
  await db.pnlSnapshots.add(snapshot as PnLSnapshot);
}

export async function getPnlSnapshots(limit = 100): Promise<PnLSnapshot[]> {
  return db.pnlSnapshots.orderBy('timestamp').reverse().limit(limit).toArray();
}

// ── Events ──

export async function saveEvent(type: string, data: string): Promise<void> {
  await db.events.add({ timestamp: Date.now(), type, data } as PetEvent);
}

export async function getEvents(limit = 50): Promise<PetEvent[]> {
  return db.events.orderBy('timestamp').reverse().limit(limit).toArray();
}

export default db;
