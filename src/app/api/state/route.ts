/**
 * Full state snapshot -- GET /api/state
 *
 * Returns the complete application state for initial SSE hydration.
 * Includes lastEventSeq and server_epoch so the client can reconcile
 * any events received between opening the EventSource and fetching
 * this snapshot.
 *
 * IMPORTANT: lastEventSeq is captured at the START of snapshot
 * generation to ensure the seq boundary is clean. Any events emitted
 * during snapshot assembly will have seq > lastEventSeq, and the
 * client will correctly apply them.
 */

export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withAuth } from '@/server/middleware/auth';
import { sseEmitter } from '@/server/engine/sseEmitter';
import {
  getPetState,
  getDecisionLog,
  getPnlSnapshots,
} from '@/server/db/repository';
import { getConfig } from '@/server/db/configStore';

export const GET = withAuth(async () => {
  // Capture seq boundary BEFORE reading any state.
  // This ensures that events emitted during snapshot assembly
  // will have seq > lastEventSeq.
  const lastEventSeq = sseEmitter.seq;
  const serverEpoch = sseEmitter.serverEpoch;
  const serverTime = Date.now();

  // Read state from SQLite (synchronous, no race conditions).
  const petStateRow = getPetState();
  const decisionLogRows = getDecisionLog(10);
  const pnlSnapshotRows = getPnlSnapshots(1);

  // Build pet state for the client.
  // ephemeral UI fields (speech_bubble, speech_bubble_until, just_evolved)
  // are NOT in SQLite -- the client manages those from SSE events.
  const petState = petStateRow
    ? {
        name: petStateRow.name,
        hunger: petStateRow.hunger,
        happiness: petStateRow.happiness,
        energy: petStateRow.energy,
        health: petStateRow.health,
        mood: petStateRow.mood,
        stage: petStateRow.stage,
        cumulative_volume: petStateRow.cumulative_volume,
        consecutive_losses: petStateRow.consecutive_losses,
        last_trade_time: petStateRow.last_trade_time,
        last_save_time: petStateRow.last_save_time,
        is_alive: petStateRow.is_alive,
        evolved_at: petStateRow.evolved_at,
        egg_id: petStateRow.egg_id ?? null,
        character_id: petStateRow.character_id ?? null,
        map_id: petStateRow.map_id ?? 'cozy',
      }
    : null;

  // Transform decision log rows to client format.
  // Timestamps in DB are epoch ms -- convert to ISO for the client.
  const decisionLog = decisionLogRows.map((row) => ({
    timestamp: new Date(row.timestamp).toISOString(),
    action: row.action,
    pair: row.pair,
    reasoning: row.reasoning,
    active_pairs: safeParseJSON(row.active_pairs, []),
    calm_pairs: safeParseJSON(row.calm_pairs, []),
    portfolio: safeParseJSON(row.portfolio, {
      balance: 0,
      equity: 0,
      unrealized_pnl: 0,
      exposure_pct: 0,
    }),
  }));

  // Latest PnL snapshot for account info approximation
  const latestPnl = pnlSnapshotRows[0] ?? null;

  // Account info derived from the latest PnL snapshot.
  // The full account info will be pushed via SSE `account_updated` events
  // once the engine is running. This provides a reasonable starting point.
  const account = latestPnl
    ? {
        balance: latestPnl.balance,
        equity: latestPnl.equity,
        unrealized_pnl: latestPnl.unrealized_pnl,
        margin_used: 0,
      }
    : null;

  // Engine status, active bots, risk metrics, and positions.
  // Imported lazily to avoid circular dependencies with the engine module.
  // The engine singleton may not exist yet if this is a fresh start.
  let engineStatus = {
    running: false,
    nextDecisionAt: null as number | null,
    lastDecisionTime: null as number | null,
    lastSyncTime: null as number | null,
  };
  let activeBots: unknown[] = [];
  const riskMetrics: unknown = null;
  const positions: unknown[] = [];

  try {
    const { engine } = await import('@/server/engine/index');
    const status = engine.getStatus();
    engineStatus = {
      running: status.running,
      nextDecisionAt: status.nextDecisionAt ?? null,
      lastDecisionTime: status.lastDecisionTime ?? null,
      lastSyncTime: status.lastSyncTime ?? null,
    };

    // Fetch active bots directly from Tread API
    try {
      const treadApi = await import('@/server/clients/treadApi');
      const bots = await treadApi.getActiveMmBots();
      activeBots = Array.isArray(bots) ? bots : [];
    } catch {
      // Tread API may be unreachable -- leave activeBots empty
    }
  } catch {
    // Engine not yet initialized -- defaults above are used
  }

  // Build config snapshot for client-side hydration
  const configSnapshot = {
    onboarded: !!getConfig('onboarded'),
    mode: getConfig<string>('mode') ?? 'auto',
    decision_interval_seconds: getConfig<number>('decision_interval_seconds') ?? 300,
    pet_name: getConfig<string>('pet_name') ?? 'Tready',
    accounts: getConfig<Array<{ name: string; id: string; exchange: string; enabled: boolean }>>('accounts') ?? [],
    treadfi_api_key_configured: !!getConfig('treadfi_api_key'),
    anthropic_api_key_configured: !!getConfig('anthropic_api_key'),
  };

  return NextResponse.json({
    account,
    positions,
    riskMetrics,
    petState,
    decisionLog,
    engineStatus,
    activeBots,
    config: configSnapshot,
    lastEventSeq,
    server_epoch: serverEpoch,
    serverTime,
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeParseJSON<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
