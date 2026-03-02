/**
 * POST /api/migrate
 *
 * One-time data migration from IndexedDB (client) to SQLite (server).
 * Accepts JSON body with: trades, outcomes, pnlSnapshots, events, activityLog, petState.
 * Validates data, bulk-inserts in a transaction, and marks migration as complete.
 */
import { NextResponse } from 'next/server';
import { withAuth } from '@/server/middleware/auth';
import { runInTransaction, updatePetState, saveActivity } from '@/server/db/repository';
import { getConfig, setConfig } from '@/server/db/configStore';
import { db } from '@/server/db';
import { trades, tradeOutcomes, pnlSnapshots, petEvents, activityLog } from '@/server/db/schema';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Payload size limits
// ---------------------------------------------------------------------------

const MAX_TRADES = 10_000;
const MAX_OUTCOMES = 10_000;
const MAX_PNL_SNAPSHOTS = 50_000;
const MAX_EVENTS = 10_000;
const MAX_ACTIVITY_LOGS = 50_000;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

interface MigrationPayload {
  trades?: Array<Record<string, unknown>>;
  outcomes?: Array<Record<string, unknown>>;
  pnlSnapshots?: Array<Record<string, unknown>>;
  events?: Array<Record<string, unknown>>;
  activityLog?: Array<Record<string, unknown>>;
  petState?: Record<string, unknown>;
}

function isValidTimestamp(v: unknown): v is number {
  return typeof v === 'number' && v > 0 && Number.isFinite(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function validateTrade(t: Record<string, unknown>, index: number): string | null {
  if (!isNonEmptyString(t.pair)) return `trades[${index}].pair must be a non-empty string`;
  if (!isNonEmptyString(t.side)) return `trades[${index}].side must be a non-empty string`;
  if (typeof t.quantity !== 'number') return `trades[${index}].quantity must be a number`;
  if (!isValidTimestamp(t.timestamp)) return `trades[${index}].timestamp must be a valid timestamp`;
  return null;
}

function validateOutcome(o: Record<string, unknown>, index: number): string | null {
  if (typeof o.trade_id !== 'number') return `outcomes[${index}].trade_id must be a number`;
  if (typeof o.realized_pnl !== 'number') return `outcomes[${index}].realized_pnl must be a number`;
  if (!['win', 'loss', 'breakeven'].includes(String(o.outcome))) return `outcomes[${index}].outcome must be win/loss/breakeven`;
  if (!isValidTimestamp(o.timestamp)) return `outcomes[${index}].timestamp must be a valid timestamp`;
  return null;
}

function validatePnlSnapshot(s: Record<string, unknown>, index: number): string | null {
  if (!isValidTimestamp(s.timestamp)) return `pnlSnapshots[${index}].timestamp must be a valid timestamp`;
  if (typeof s.balance !== 'number') return `pnlSnapshots[${index}].balance must be a number`;
  if (typeof s.equity !== 'number') return `pnlSnapshots[${index}].equity must be a number`;
  return null;
}

function validateEvent(e: Record<string, unknown>, index: number): string | null {
  if (!isValidTimestamp(e.timestamp)) return `events[${index}].timestamp must be a valid timestamp`;
  if (!isNonEmptyString(e.type)) return `events[${index}].type must be a non-empty string`;
  return null;
}

function validateActivityEntry(a: Record<string, unknown>, index: number): string | null {
  if (!isValidTimestamp(a.timestamp)) return `activityLog[${index}].timestamp must be a valid timestamp`;
  if (!isNonEmptyString(a.category)) return `activityLog[${index}].category must be a non-empty string`;
  if (!isNonEmptyString(a.action)) return `activityLog[${index}].action must be a non-empty string`;
  return null;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const POST = withAuth(async (request: Request) => {
  // Check if migration was already performed
  const migrated = getConfig<boolean>('migration_complete');
  if (migrated) {
    return NextResponse.json(
      { error: 'Migration already completed' },
      { status: 409 },
    );
  }

  let body: MigrationPayload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json(
      { error: 'Request body must be a JSON object' },
      { status: 400 },
    );
  }

  // ---------------------------------------------------------------------------
  // Enforce payload size limits
  // ---------------------------------------------------------------------------

  const tradeRows = body.trades || [];
  const outcomeRows = body.outcomes || [];
  const pnlRows = body.pnlSnapshots || [];
  const eventRows = body.events || [];
  const activityRows = body.activityLog || [];

  if (tradeRows.length > MAX_TRADES) {
    return NextResponse.json({ error: `Too many trades (max ${MAX_TRADES})` }, { status: 400 });
  }
  if (outcomeRows.length > MAX_OUTCOMES) {
    return NextResponse.json({ error: `Too many outcomes (max ${MAX_OUTCOMES})` }, { status: 400 });
  }
  if (pnlRows.length > MAX_PNL_SNAPSHOTS) {
    return NextResponse.json({ error: `Too many PnL snapshots (max ${MAX_PNL_SNAPSHOTS})` }, { status: 400 });
  }
  if (eventRows.length > MAX_EVENTS) {
    return NextResponse.json({ error: `Too many events (max ${MAX_EVENTS})` }, { status: 400 });
  }
  if (activityRows.length > MAX_ACTIVITY_LOGS) {
    return NextResponse.json({ error: `Too many activity logs (max ${MAX_ACTIVITY_LOGS})` }, { status: 400 });
  }

  // ---------------------------------------------------------------------------
  // Validate all data before inserting
  // ---------------------------------------------------------------------------

  const errors: string[] = [];

  for (let i = 0; i < tradeRows.length; i++) {
    const err = validateTrade(tradeRows[i], i);
    if (err) errors.push(err);
  }
  for (let i = 0; i < outcomeRows.length; i++) {
    const err = validateOutcome(outcomeRows[i], i);
    if (err) errors.push(err);
  }
  for (let i = 0; i < pnlRows.length; i++) {
    const err = validatePnlSnapshot(pnlRows[i], i);
    if (err) errors.push(err);
  }
  for (let i = 0; i < eventRows.length; i++) {
    const err = validateEvent(eventRows[i], i);
    if (err) errors.push(err);
  }
  for (let i = 0; i < activityRows.length; i++) {
    const err = validateActivityEntry(activityRows[i], i);
    if (err) errors.push(err);
  }

  if (errors.length > 0) {
    return NextResponse.json(
      { error: 'Validation failed', details: errors.slice(0, 20) },
      { status: 400 },
    );
  }

  // ---------------------------------------------------------------------------
  // Bulk insert in a transaction
  // ---------------------------------------------------------------------------

  try {
    const counts = runInTransaction(() => {
      let tradeCount = 0;
      let outcomeCount = 0;
      let pnlCount = 0;
      let eventCount = 0;
      let activityCount = 0;

      // Insert trades, building a mapping from old IndexedDB IDs to new SQLite IDs
      const tradeIdMap = new Map<number, number>();

      for (const t of tradeRows) {
        const oldId = Number(t.id);
        const result = db.insert(trades)
          .values({
            treadfi_id: t.treadfi_id as string | undefined,
            pair: t.pair as string,
            side: t.side as string,
            quantity: Number(t.quantity),
            price: t.price != null ? Number(t.price) : null,
            status: (t.status as string) || 'completed',
            reasoning: (t.reasoning as string) || '',
            mm_params: (t.mm_params as string) || '{}',
            account_name: t.account_name as string | undefined,
            exchange: t.exchange as string | undefined,
            source: (t.source as string) || 'migrated',
            submitted_at: t.submitted_at != null ? Number(t.submitted_at) : null,
            timestamp: Number(t.timestamp),
          })
          .returning({ id: trades.id })
          .get();

        if (result) {
          tradeIdMap.set(oldId, result.id);
        }
        tradeCount++;
      }

      // Insert trade outcomes using mapped IDs
      for (const o of outcomeRows) {
        const newTradeId = tradeIdMap.get(Number(o.trade_id));
        if (!newTradeId) continue; // Skip orphaned outcomes

        db.insert(tradeOutcomes)
          .values({
            trade_id: newTradeId,
            realized_pnl: Number(o.realized_pnl),
            outcome: o.outcome as string,
            timestamp: Number(o.timestamp),
          })
          .run();
        outcomeCount++;
      }

      // Insert PnL snapshots
      for (const s of pnlRows) {
        db.insert(pnlSnapshots)
          .values({
            timestamp: Number(s.timestamp),
            balance: Number(s.balance),
            equity: Number(s.equity),
            unrealized_pnl: Number(s.unrealized_pnl || 0),
            num_positions: Number(s.num_positions || 0),
          })
          .run();
        pnlCount++;
      }

      // Insert pet events
      for (const e of eventRows) {
        db.insert(petEvents)
          .values({
            timestamp: Number(e.timestamp),
            type: e.type as string,
            data: typeof e.data === 'string' ? e.data : JSON.stringify(e.data || {}),
          })
          .run();
        eventCount++;
      }

      // Insert activity log
      for (const a of activityRows) {
        db.insert(activityLog)
          .values({
            timestamp: Number(a.timestamp),
            category: a.category as string,
            action: a.action as string,
            pair: (a.pair as string) || null,
            detail: typeof a.detail === 'string' ? a.detail : JSON.stringify(a.detail || ''),
          })
          .run();
        activityCount++;
      }

      // Migrate pet state if provided
      if (body.petState && typeof body.petState === 'object') {
        const ps = body.petState;
        const vitals = (ps.vitals && typeof ps.vitals === 'object' ? ps.vitals : {}) as Record<string, unknown>;
        updatePetState({
          name: (ps.name as string) || 'Treadmagotchi',
          hunger: Number(ps.hunger ?? vitals.hunger ?? 100),
          happiness: Number(ps.happiness ?? vitals.happiness ?? 100),
          energy: Number(ps.energy ?? vitals.energy ?? 100),
          health: Number(ps.health ?? vitals.health ?? 100),
          mood: (ps.mood as string) || 'content',
          stage: (ps.stage as string) || 'EGG',
          cumulative_volume: Number(ps.cumulative_volume ?? 0),
          consecutive_losses: Number(ps.consecutive_losses ?? 0),
          last_trade_time: ps.last_trade_time != null ? Number(ps.last_trade_time) : null,
          last_save_time: Date.now(),
          is_alive: ps.is_alive !== false,
          evolved_at: ps.evolved_at != null ? Number(ps.evolved_at) : null,
        });
      }

      // Mark migration as complete INSIDE the transaction to prevent
      // corrupt re-migration if server crashes between commit and flag write
      setConfig('migration_complete', true);

      return { tradeCount, outcomeCount, pnlCount, eventCount, activityCount };
    });

    // Log the migration
    saveActivity({
      timestamp: Date.now(),
      category: 'engine',
      action: 'migration',
      pair: null,
      detail: JSON.stringify({
        trades: counts.tradeCount,
        outcomes: counts.outcomeCount,
        pnlSnapshots: counts.pnlCount,
        events: counts.eventCount,
        activityLog: counts.activityCount,
        petState: !!body.petState,
      }),
    });

    return NextResponse.json({
      success: true,
      migrated: {
        trades: counts.tradeCount,
        outcomes: counts.outcomeCount,
        pnlSnapshots: counts.pnlCount,
        events: counts.eventCount,
        activityLog: counts.activityCount,
        petState: !!body.petState,
      },
    });
  } catch (err) {
    console.error('[api/migrate] POST error:', err);
    return NextResponse.json(
      { error: 'Migration failed: ' + (err instanceof Error ? err.message : String(err)) },
      { status: 500 },
    );
  }
});
