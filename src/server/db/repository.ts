/**
 * Data repository layer — SQLite via Drizzle ORM.
 *
 * Mirrors every export from the Dexie (IndexedDB) persistence layer
 * but backed by better-sqlite3. All functions are SYNCHRONOUS.
 *
 * Also exposes additional functions for server-only tables
 * (pet_state, decision_log, risk_state, daily_losses, bot_volumes).
 */
import { eq, desc, and, or, inArray, lt, sql } from 'drizzle-orm';
import { db, sqlite } from './index';
import {
  trades,
  tradeOutcomes,
  pnlSnapshots,
  petEvents,
  activityLog,
  petState,
  decisionLog,
  riskState,
  dailyLosses,
  botVolumes,
  type Trade,
  type NewTrade,
  type TradeOutcome,
  type PnlSnapshot,
  type NewPnlSnapshot,
  type PetEventRow,
  type ActivityLogRow,
  type NewActivityLog,
  type PetStateRow,
  type DecisionLogRow,
  type NewDecisionLog,
  type RiskStateRow,
} from './schema';

// ---------------------------------------------------------------------------
// Transaction helper
// ---------------------------------------------------------------------------

/**
 * Run a function inside a better-sqlite3 transaction.
 * Automatically commits on success or rolls back on error.
 */
export function runInTransaction<T>(fn: () => T): T {
  const txn = sqlite.transaction(fn);
  return txn();
}

// ---------------------------------------------------------------------------
// Trade operations
// ---------------------------------------------------------------------------

/** Insert a trade and return the full row with generated ID. */
export function saveTrade(trade: NewTrade): Trade {
  const result = db
    .insert(trades)
    .values(trade)
    .returning()
    .get();
  return result;
}

/** Update a trade's status, optionally setting treadfi_id. */
export function updateTradeStatus(id: number, status: string, treadfiId?: string): void {
  if (treadfiId !== undefined) {
    db.update(trades)
      .set({ status, treadfi_id: treadfiId })
      .where(eq(trades.id, id))
      .run();
  } else {
    db.update(trades)
      .set({ status })
      .where(eq(trades.id, id))
      .run();
  }
}

/** Update the mm_params JSON string on a trade. */
export function updateTradeMmParams(id: number, mmParams: string): void {
  db.update(trades)
    .set({ mm_params: mmParams })
    .where(eq(trades.id, id))
    .run();
}

/**
 * Fetch trades ordered by timestamp descending.
 * Supports cursor-based pagination using a composite (timestamp, id) cursor
 * to avoid skipping trades with identical timestamps.
 */
export function getTrades(limit = 50, before?: number, beforeId?: number): Trade[] {
  if (before != null && beforeId != null) {
    // Composite cursor: rows before (timestamp, id) in descending order
    return db
      .select()
      .from(trades)
      .where(
        or(
          lt(trades.timestamp, before),
          and(eq(trades.timestamp, before), lt(trades.id, beforeId)),
        ),
      )
      .orderBy(desc(trades.timestamp), desc(trades.id))
      .limit(limit)
      .all();
  }
  if (before != null) {
    return db
      .select()
      .from(trades)
      .where(lt(trades.timestamp, before))
      .orderBy(desc(trades.timestamp), desc(trades.id))
      .limit(limit)
      .all();
  }
  return db
    .select()
    .from(trades)
    .orderBy(desc(trades.timestamp), desc(trades.id))
    .limit(limit)
    .all();
}

/** Return only trades with an active status (submitted or active). */
export function getActiveTradesOnly(): Trade[] {
  return db
    .select()
    .from(trades)
    .where(inArray(trades.status, ['submitted', 'active']))
    .orderBy(desc(trades.timestamp))
    .all();
}

// ---------------------------------------------------------------------------
// Trade outcomes
// ---------------------------------------------------------------------------

/**
 * Record a trade outcome. Automatically classifies as win/loss/breakeven
 * using the same thresholds as the Dexie layer.
 */
export function saveTradeOutcome(tradeId: number, pnl: number): void {
  const outcome = pnl > 0.001 ? 'win' : pnl < -0.001 ? 'loss' : 'breakeven';
  db.insert(tradeOutcomes)
    .values({
      trade_id: tradeId,
      realized_pnl: pnl,
      outcome,
      timestamp: Date.now(),
    })
    .onConflictDoNothing()
    .run();
}

/** Fetch recent trade outcomes ordered by timestamp descending. */
export function getTradeOutcomes(limit = 20): TradeOutcome[] {
  return db
    .select()
    .from(tradeOutcomes)
    .orderBy(desc(tradeOutcomes.timestamp))
    .limit(limit)
    .all();
}

/**
 * Get trades joined with their outcomes for AI learning context.
 * Uses a LEFT JOIN so trades without outcomes still appear.
 */
export function getTradesWithOutcomes(
  limit = 30,
): Array<{ trade: Trade; outcome: TradeOutcome | null }> {
  const rows = db
    .select({
      trade: trades,
      outcome: tradeOutcomes,
    })
    .from(trades)
    .leftJoin(tradeOutcomes, eq(trades.id, tradeOutcomes.trade_id))
    .where(
      inArray(trades.status, [
        'completed',
        'stop_loss',
        'take_profit',
        'canceled',
        'failed',
      ]),
    )
    .orderBy(desc(trades.timestamp))
    .limit(limit)
    .all();

  return rows.map((row) => ({
    trade: row.trade,
    outcome: row.outcome?.id != null ? row.outcome : null,
  }));
}

// ---------------------------------------------------------------------------
// PnL snapshots
// ---------------------------------------------------------------------------

/** Persist a PnL snapshot. */
export function savePnlSnapshot(snapshot: NewPnlSnapshot): void {
  db.insert(pnlSnapshots).values(snapshot).run();
}

/** Fetch recent PnL snapshots ordered by timestamp descending. */
export function getPnlSnapshots(limit = 100): PnlSnapshot[] {
  return db
    .select()
    .from(pnlSnapshots)
    .orderBy(desc(pnlSnapshots.timestamp))
    .limit(limit)
    .all();
}

// ---------------------------------------------------------------------------
// Pet events
// ---------------------------------------------------------------------------

/** Record a pet event. */
export function saveEvent(type: string, data: string): void {
  db.insert(petEvents)
    .values({ timestamp: Date.now(), type, data })
    .run();
}

/** Fetch recent pet events ordered by timestamp descending. */
export function getEvents(limit = 50): PetEventRow[] {
  return db
    .select()
    .from(petEvents)
    .orderBy(desc(petEvents.timestamp))
    .limit(limit)
    .all();
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

/** Record an activity log entry. */
export function saveActivity(entry: NewActivityLog): void {
  db.insert(activityLog).values(entry).run();
}

/** Fetch recent activity log entries ordered by timestamp descending. */
export function getActivityLog(limit = 100): ActivityLogRow[] {
  return db
    .select()
    .from(activityLog)
    .orderBy(desc(activityLog.timestamp))
    .limit(limit)
    .all();
}

/** Fetch activity log entries filtered by category. */
export function getActivityByCategory(category: string, limit = 50): ActivityLogRow[] {
  return db
    .select()
    .from(activityLog)
    .where(eq(activityLog.category, category))
    .orderBy(desc(activityLog.timestamp))
    .limit(limit)
    .all();
}

// ---------------------------------------------------------------------------
// Pet state (single-row, id=1)
// ---------------------------------------------------------------------------

/** Returns the single pet_state row, or null if none exists. */
export function getPetState(): PetStateRow | null {
  const row = db
    .select()
    .from(petState)
    .where(eq(petState.id, 1))
    .get();
  return row ?? null;
}

/**
 * Upsert the pet state row (always id=1).
 * Merges provided fields with the existing row.
 */
export function updatePetState(updates: Partial<PetStateRow>): void {
  const existing = getPetState();
  if (!existing) {
    // No row yet — insert with defaults merged with updates
    const { id: _uid, ...safeUpdates } = updates;
    db.insert(petState)
      .values({
        id: 1,
        name: 'Treadmagotchi',
        hunger: 100,
        happiness: 100,
        energy: 100,
        health: 100,
        mood: 'content',
        stage: 'EGG',
        cumulative_volume: 0,
        consecutive_losses: 0,
        last_save_time: Date.now(),
        is_alive: true,
        ...safeUpdates,
      } as typeof petState.$inferInsert)
      .run();
  } else {
    // Row exists — update only provided fields
    const { id: _id, ...rest } = updates;
    db.update(petState)
      .set(rest)
      .where(eq(petState.id, 1))
      .run();
  }
}

/** Create the initial pet state if none exists. */
export function initPetState(name: string): void {
  const existing = getPetState();
  if (existing) return;

  db.insert(petState)
    .values({
      id: 1,
      name,
      hunger: 100,
      happiness: 100,
      energy: 100,
      health: 100,
      mood: 'content',
      stage: 'EGG',
      cumulative_volume: 0,
      consecutive_losses: 0,
      last_save_time: Date.now(),
      is_alive: true,
    })
    .run();
}

// ---------------------------------------------------------------------------
// Decision log
// ---------------------------------------------------------------------------

/** Fetch recent decision log entries ordered by timestamp descending. */
export function getDecisionLog(limit = 50): DecisionLogRow[] {
  return db
    .select()
    .from(decisionLog)
    .orderBy(desc(decisionLog.timestamp))
    .limit(limit)
    .all();
}

/** Add a decision log entry. */
export function addDecision(entry: NewDecisionLog): void {
  db.insert(decisionLog).values(entry).run();
}

// ---------------------------------------------------------------------------
// Risk state (single-row, id=1)
// ---------------------------------------------------------------------------

/** Returns the single risk_state row, or null if none exists. */
export function getRiskState(): RiskStateRow | null {
  const row = db
    .select()
    .from(riskState)
    .where(eq(riskState.id, 1))
    .get();
  return row ?? null;
}

/** Upsert the risk state row with peak equity. */
export function updateRiskState(peakEquity: number): void {
  db.insert(riskState)
    .values({
      id: 1,
      peak_equity: peakEquity,
      updated_at: Date.now(),
    })
    .onConflictDoUpdate({
      target: riskState.id,
      set: {
        peak_equity: peakEquity,
        updated_at: Date.now(),
      },
    })
    .run();
}

// ---------------------------------------------------------------------------
// Daily losses
// ---------------------------------------------------------------------------

/** Returns the total_loss for a given date string (e.g. '2026-03-02'), or 0. */
export function getDailyLoss(date: string): number {
  const row = db
    .select({ total_loss: dailyLosses.total_loss })
    .from(dailyLosses)
    .where(eq(dailyLosses.date, date))
    .get();
  return row?.total_loss ?? 0;
}

/** Upsert the daily loss for a given date. */
export function setDailyLoss(date: string, amount: number): void {
  db.insert(dailyLosses)
    .values({
      date,
      total_loss: amount,
      updated_at: Date.now(),
    })
    .onConflictDoUpdate({
      target: dailyLosses.date,
      set: {
        total_loss: amount,
        updated_at: Date.now(),
      },
    })
    .run();
}

// ---------------------------------------------------------------------------
// Bot volumes
// ---------------------------------------------------------------------------

/** Returns the last_known_volume for a bot, or 0 if not tracked. */
export function getBotVolume(botId: string): number {
  const row = db
    .select({ last_known_volume: botVolumes.last_known_volume })
    .from(botVolumes)
    .where(eq(botVolumes.bot_id, botId))
    .get();
  return row?.last_known_volume ?? 0;
}

/** Upsert the last known volume for a bot. */
export function setBotVolume(botId: string, volume: number): void {
  db.insert(botVolumes)
    .values({
      bot_id: botId,
      last_known_volume: volume,
      updated_at: Date.now(),
    })
    .onConflictDoUpdate({
      target: botVolumes.bot_id,
      set: {
        last_known_volume: volume,
        updated_at: Date.now(),
      },
    })
    .run();
}

// ---------------------------------------------------------------------------
// Data retention — batched deletes to avoid blocking
// ---------------------------------------------------------------------------

const BATCH_SIZE = 500;

const RETENTION_DAYS = {
  activityLog: 90,
  pnlSnapshots: 180,
  petEvents: 180,
  dailyLosses: 30,
  configHistory: 90,
  decisionLog: 90,
} as const;

function msAgo(days: number): number {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function dateAgo(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/**
 * Batched delete helper for tables with integer timestamp columns.
 * Deletes rows older than `cutoffMs` in batches of BATCH_SIZE.
 */
function pruneByTimestamp(
  table: typeof activityLog | typeof pnlSnapshots | typeof petEvents,
  cutoffMs: number,
): void {
  // Use raw SQL for batched deletes since Drizzle doesn't support DELETE ... LIMIT
  const tableName =
    table === activityLog
      ? 'activity_log'
      : table === pnlSnapshots
        ? 'pnl_snapshots'
        : 'pet_events';

  const stmt = sqlite.prepare(
    `DELETE FROM ${tableName} WHERE id IN (
      SELECT id FROM ${tableName} WHERE timestamp < ? LIMIT ?
    )`,
  );

  let deleted: number;
  do {
    const result = stmt.run(cutoffMs, BATCH_SIZE);
    deleted = result.changes;
  } while (deleted === BATCH_SIZE);
}

/**
 * Batched delete helper for tables using a non-standard timestamp column name.
 * Uses raw SQL since the column name differs from `timestamp`.
 */
function pruneByColumnName(tableName: string, columnName: string, cutoffMs: number): void {
  const stmt = sqlite.prepare(
    `DELETE FROM ${tableName} WHERE id IN (
      SELECT id FROM ${tableName} WHERE ${columnName} < ? LIMIT ?
    )`,
  );

  let deleted: number;
  do {
    const result = stmt.run(cutoffMs, BATCH_SIZE);
    deleted = result.changes;
  } while (deleted === BATCH_SIZE);
}

/**
 * Prune old data across all retention-managed tables.
 *
 * Retention periods:
 * - activity_log: 90 days
 * - pnl_snapshots: 180 days
 * - pet_events: 180 days
 * - daily_losses: 30 days
 * - config_history: 90 days
 * - decision_log: 90 days
 */
export function pruneOldData(): void {
  // Timestamp-based tables
  pruneByTimestamp(activityLog, msAgo(RETENTION_DAYS.activityLog));
  pruneByTimestamp(pnlSnapshots, msAgo(RETENTION_DAYS.pnlSnapshots));
  pruneByTimestamp(petEvents, msAgo(RETENTION_DAYS.petEvents));

  // config_history uses `changed_at` column instead of `timestamp`
  pruneByColumnName('config_history', 'changed_at', msAgo(RETENTION_DAYS.configHistory));

  // decision_log uses standard `timestamp` column
  pruneByColumnName('decision_log', 'timestamp', msAgo(RETENTION_DAYS.decisionLog));

  // daily_losses uses a date string primary key — batched delete by date comparison
  const cutoffDate = dateAgo(RETENTION_DAYS.dailyLosses);
  const dailyStmt = sqlite.prepare(
    `DELETE FROM daily_losses WHERE date IN (
      SELECT date FROM daily_losses WHERE date < ? LIMIT ?
    )`,
  );

  let deleted: number;
  do {
    const result = dailyStmt.run(cutoffDate, BATCH_SIZE);
    deleted = result.changes;
  } while (deleted === BATCH_SIZE);
}
