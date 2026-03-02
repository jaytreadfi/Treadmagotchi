/**
 * SQLite schema via Drizzle ORM.
 * All tables use INTEGER timestamps (epoch ms) for consistency.
 */
import { sqliteTable, text, integer, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

// ── Trades ──

export const trades = sqliteTable('trades', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  treadfi_id: text('treadfi_id'),
  pair: text('pair').notNull(),
  side: text('side').notNull(),
  quantity: real('quantity').notNull(),
  price: real('price'),
  status: text('status').notNull().default('pending'),
  reasoning: text('reasoning').notNull().default(''),
  mm_params: text('mm_params').notNull().default('{}'), // JSON
  account_name: text('account_name'),
  exchange: text('exchange'),
  source: text('source').notNull().default('ai'),
  submitted_at: integer('submitted_at'),
  timestamp: integer('timestamp').notNull(),
}, (table) => [
  uniqueIndex('trades_treadfi_id_uniq').on(table.treadfi_id),
  index('trades_status_ts').on(table.status, table.timestamp),
  index('trades_pair_ts').on(table.pair, table.timestamp),
  index('trades_ts').on(table.timestamp),
]);

export type Trade = typeof trades.$inferSelect;
export type NewTrade = typeof trades.$inferInsert;

// ── Trade Outcomes ──

export const tradeOutcomes = sqliteTable('trade_outcomes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  trade_id: integer('trade_id').notNull().references(() => trades.id),
  realized_pnl: real('realized_pnl').notNull(),
  outcome: text('outcome').notNull(), // 'win' | 'loss' | 'breakeven'
  timestamp: integer('timestamp').notNull(),
}, (table) => [
  uniqueIndex('outcomes_trade_id_uniq').on(table.trade_id),
  index('outcomes_outcome_ts').on(table.outcome, table.timestamp),
  index('outcomes_ts').on(table.timestamp),
]);

export type TradeOutcome = typeof tradeOutcomes.$inferSelect;
export type NewTradeOutcome = typeof tradeOutcomes.$inferInsert;

// ── PnL Snapshots ──

export const pnlSnapshots = sqliteTable('pnl_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  timestamp: integer('timestamp').notNull(),
  balance: real('balance').notNull(),
  equity: real('equity').notNull(),
  unrealized_pnl: real('unrealized_pnl').notNull(),
  num_positions: integer('num_positions').notNull(),
}, (table) => [
  index('pnl_ts').on(table.timestamp),
]);

export type PnlSnapshot = typeof pnlSnapshots.$inferSelect;
export type NewPnlSnapshot = typeof pnlSnapshots.$inferInsert;

// ── Pet Events ──

export const petEvents = sqliteTable('pet_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  timestamp: integer('timestamp').notNull(),
  type: text('type').notNull(),
  data: text('data').notNull().default('{}'), // JSON
}, (table) => [
  index('events_type_ts').on(table.type, table.timestamp),
  index('events_ts').on(table.timestamp),
]);

export type PetEventRow = typeof petEvents.$inferSelect;
export type NewPetEvent = typeof petEvents.$inferInsert;

// ── Activity Log ──

export const activityLog = sqliteTable('activity_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  timestamp: integer('timestamp').notNull(),
  category: text('category').notNull(), // 'decision' | 'monitor' | 'engine' | 'error'
  action: text('action').notNull(),
  pair: text('pair'),
  detail: text('detail').notNull().default(''), // JSON string
}, (table) => [
  index('activity_cat_ts').on(table.category, table.timestamp),
  index('activity_ts').on(table.timestamp),
]);

export type ActivityLogRow = typeof activityLog.$inferSelect;
export type NewActivityLog = typeof activityLog.$inferInsert;

// ── Config (key-value store) ──

export const config = sqliteTable('config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(), // JSON-encoded
  updated_at: integer('updated_at').notNull(),
});

export type ConfigRow = typeof config.$inferSelect;

// ── Config History (audit trail) ──

export const configHistory = sqliteTable('config_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull(),
  old_value: text('old_value'),
  new_value: text('new_value').notNull(),
  changed_at: integer('changed_at').notNull(),
});

// ── Pet State (single-row) ──

export const petState = sqliteTable('pet_state', {
  id: integer('id').primaryKey().default(1),
  name: text('name').notNull().default('Treadmagotchi'),
  hunger: real('hunger').notNull().default(100),
  happiness: real('happiness').notNull().default(100),
  energy: real('energy').notNull().default(100),
  health: real('health').notNull().default(100),
  mood: text('mood').notNull().default('content'),
  stage: text('stage').notNull().default('EGG'),
  cumulative_volume: real('cumulative_volume').notNull().default(0),
  consecutive_losses: integer('consecutive_losses').notNull().default(0),
  last_trade_time: integer('last_trade_time'),
  last_save_time: integer('last_save_time').notNull(),
  is_alive: integer('is_alive', { mode: 'boolean' }).notNull().default(true),
  evolved_at: integer('evolved_at'),
});

export type PetStateRow = typeof petState.$inferSelect;

// ── Decision Log ──

export const decisionLog = sqliteTable('decision_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  timestamp: integer('timestamp').notNull(), // epoch ms (normalized from ISO strings)
  action: text('action').notNull(),
  pair: text('pair'),
  reasoning: text('reasoning').notNull().default(''),
  active_pairs: text('active_pairs').notNull().default('[]'), // JSON array
  calm_pairs: text('calm_pairs').notNull().default('[]'), // JSON array
  portfolio: text('portfolio').notNull().default('{}'), // JSON snapshot
}, (table) => [
  index('decisions_ts').on(table.timestamp),
]);

export type DecisionLogRow = typeof decisionLog.$inferSelect;
export type NewDecisionLog = typeof decisionLog.$inferInsert;

// ── Risk State (single-row) ──

export const riskState = sqliteTable('risk_state', {
  id: integer('id').primaryKey().default(1),
  peak_equity: real('peak_equity').notNull().default(100),
  updated_at: integer('updated_at').notNull(),
});

export type RiskStateRow = typeof riskState.$inferSelect;

// ── Daily Losses ──

export const dailyLosses = sqliteTable('daily_losses', {
  date: text('date').primaryKey(), // e.g. '2026-03-02'
  total_loss: real('total_loss').notNull().default(0),
  updated_at: integer('updated_at').notNull(),
});

export type DailyLossRow = typeof dailyLosses.$inferSelect;

// ── Bot Volumes (persists lastKnownVolume across restarts) ──

export const botVolumes = sqliteTable('bot_volumes', {
  bot_id: text('bot_id').primaryKey(),
  last_known_volume: real('last_known_volume').notNull().default(0),
  updated_at: integer('updated_at').notNull(),
});

export type BotVolumeRow = typeof botVolumes.$inferSelect;
