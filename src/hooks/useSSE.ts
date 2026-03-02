'use client';

/**
 * useSSE -- client-side SSE hook that replaces useTradingLoop.
 *
 * Hydration strategy (handles race between snapshot and stream):
 * 1. Open EventSource('/api/events') first -- buffer incoming events into a ref
 * 2. Fetch GET /api/state -- hydrate all Zustand stores, note lastEventSeq and server_epoch
 * 3. Compute clockOffset = serverTime - Date.now()
 * 4. Apply buffered events with seq > lastEventSeq AND matching server_epoch
 * 5. Switch to live mode -- dispatch events to stores directly
 *
 * On reconnect, re-runs the full hydration sequence.
 * Stores are NOT cleared on reconnect to avoid a flash of empty state.
 */

import { useEffect, useRef, useState } from 'react';
import { useTradingStore } from '@/store/useTradingStore';
import { usePetStore } from '@/store/usePetStore';
import { useConfigStore } from '@/store/useConfigStore';
import type {
  AccountInfo,
  Position,
  RiskMetrics,
  DecisionLogEntry,
  PetVitals,
  PetMood,
  PetMode,
  EvolutionStage,
} from '@/lib/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BUFFER_SIZE_CAP = 500;
const SSE_URL = '/api/events';
const STATE_URL = '/api/state';
const CONNECTION_TIMEOUT_MS = 15000;

/** Module-level clock offset so dispatchEvent can adjust server timestamps. */
let moduleClockOffset = 0;

// ---------------------------------------------------------------------------
// Types (duplicated from sseEmitter to avoid importing server module)
// ---------------------------------------------------------------------------

type SSEEventType =
  | 'decision_made'
  | 'bot_synced'
  | 'pet_updated'
  | 'account_updated'
  | 'engine_status'
  | 'trade_completed'
  | 'evolution'
  | 'activity_logged'
  | 'pnl_snapshot'
  | 'error';

/** Shape of the parsed SSE frame data (matches what the route sends). */
interface SSEFrame {
  data: unknown;
  seq: number;
  server_epoch: number;
}

/** Buffered event including the event type name. */
interface BufferedEvent {
  eventType: SSEEventType;
  frame: SSEFrame;
}

/** Shape returned by GET /api/state */
interface StateSnapshot {
  account: AccountInfo | null;
  positions: Position[];
  riskMetrics: RiskMetrics | null;
  petState: {
    name: string;
    hunger: number;
    happiness: number;
    energy: number;
    health: number;
    mood: PetMood;
    stage: EvolutionStage;
    cumulative_volume: number;
    consecutive_losses: number;
    last_trade_time: number | null;
    last_save_time: number;
    is_alive: boolean;
    evolved_at: number | null;
  } | null;
  decisionLog: DecisionLogEntry[];
  engineStatus: {
    running: boolean;
    nextDecisionAt: number | null;
    lastDecisionTime: number | null;
    lastSyncTime: number | null;
  };
  activeBots: Array<Record<string, unknown>>;
  config: {
    onboarded: boolean;
    mode: PetMode;
    decision_interval_seconds: number;
    pet_name: string;
    accounts: Array<{ name: string; id: string; exchange: string; enabled: boolean }>;
    treadfi_api_key_configured: boolean;
    anthropic_api_key_configured: boolean;
  };
  lastEventSeq: number;
  server_epoch: number;
  serverTime: number;
}

export interface UseSSEReturn {
  loading: boolean;
  connected: boolean;
  error: string | null;
  clockOffset: number;
}

// ---------------------------------------------------------------------------
// Event types the EventSource listens for
// ---------------------------------------------------------------------------

const EVENT_TYPES: SSEEventType[] = [
  'decision_made',
  'bot_synced',
  'pet_updated',
  'account_updated',
  'engine_status',
  'trade_completed',
  'evolution',
  'activity_logged',
  'pnl_snapshot',
  'error',
];

// ---------------------------------------------------------------------------
// Event dispatch -- updates Zustand stores from SSE events
// ---------------------------------------------------------------------------

function dispatchEvent(type: SSEEventType, data: unknown): void {
  switch (type) {
    case 'decision_made': {
      const d = data as {
        entry?: DecisionLogEntry;
        lastDecisionTime?: number;
        nextDecisionAt?: number;
      };
      const trading = useTradingStore.getState();
      if (d.entry) trading.addDecision(d.entry);
      if (d.lastDecisionTime != null) trading.setLastDecisionTime(d.lastDecisionTime);
      if (d.nextDecisionAt != null) trading.setNextDecisionAt(d.nextDecisionAt);
      break;
    }

    case 'bot_synced': {
      const d = data as { activeBots?: Array<Record<string, unknown>> };
      if (d.activeBots) {
        useTradingStore.getState().setActiveBots(d.activeBots);
      }
      break;
    }

    case 'pet_updated': {
      const d = data as Record<string, unknown>;
      const pet = usePetStore.getState();

      // Build a partial hydration object for a single batched setState call
      const patch: Record<string, unknown> = {};

      // Vitals
      const vitals: Partial<PetVitals> = {};
      if (d.hunger != null) vitals.hunger = d.hunger as number;
      if (d.happiness != null) vitals.happiness = d.happiness as number;
      if (d.energy != null) vitals.energy = d.energy as number;
      if (d.health != null) vitals.health = d.health as number;
      if (Object.keys(vitals).length > 0) {
        // Must use setVitals for clamping logic
        pet.setVitals(vitals);
      }

      if (d.mood != null) patch.mood = d.mood;
      if (d.stage != null) patch.stage = d.stage;
      if (d.cumulative_volume != null) patch.cumulative_volume = d.cumulative_volume;
      if (d.consecutive_losses != null) patch.consecutive_losses = d.consecutive_losses;
      if (d.last_trade_time !== undefined) patch.last_trade_time = d.last_trade_time;
      if (d.is_alive != null) patch.is_alive = d.is_alive;
      if (d.evolved_at !== undefined) patch.evolved_at = d.evolved_at;

      if (Object.keys(patch).length > 0) {
        pet.hydrate(patch);
      }

      // Speech bubble -- ephemeral, client-side managed
      if (d.speech_bubble !== undefined) {
        const durationMs = d.speech_bubble_until
          ? (d.speech_bubble_until as number) - (Date.now() + moduleClockOffset)
          : undefined;
        pet.setSpeechBubble(
          d.speech_bubble as string | null,
          durationMs && durationMs > 0 ? durationMs : undefined,
        );
      }

      break;
    }

    case 'account_updated': {
      const d = data as Partial<AccountInfo> & { positions?: Position[] };
      const trading = useTradingStore.getState();
      if (d.balance != null) {
        trading.setAccount({
          balance: d.balance,
          equity: d.equity ?? 0,
          unrealized_pnl: d.unrealized_pnl ?? 0,
          margin_used: d.margin_used ?? 0,
        });
      }
      if (d.positions) {
        trading.setPositions(d.positions);
      }
      break;
    }

    case 'engine_status': {
      const d = data as {
        running?: boolean;
        nextDecisionAt?: number | null;
        lastDecisionTime?: number | null;
        lastSyncTime?: number | null;
      };
      const trading = useTradingStore.getState();
      // Batch all engine status updates in a single setState
      const patch: Record<string, unknown> = {};
      if (d.running != null) patch.engineRunning = d.running;
      if (d.nextDecisionAt !== undefined) patch.nextDecisionAt = d.nextDecisionAt;
      if (d.lastDecisionTime != null) patch.lastDecisionTime = d.lastDecisionTime;
      if (d.lastSyncTime != null) patch.lastSyncTime = d.lastSyncTime;
      if (Object.keys(patch).length > 0) {
        trading.hydrate(patch);
      }
      break;
    }

    case 'trade_completed': {
      const d = data as {
        account?: AccountInfo;
        positions?: Position[];
        riskMetrics?: RiskMetrics;
      };
      const trading = useTradingStore.getState();
      if (d.account) trading.setAccount(d.account);
      if (d.positions) trading.setPositions(d.positions);
      if (d.riskMetrics) trading.setRiskMetrics(d.riskMetrics);
      break;
    }

    case 'evolution': {
      const d = data as {
        stage?: EvolutionStage;
        evolved_at?: number | null;
      };
      const pet = usePetStore.getState();
      if (d.stage) pet.setStage(d.stage);
      if (d.evolved_at != null) pet.setEvolvedAt(d.evolved_at);
      break;
    }

    case 'activity_logged': {
      // Informational for the activity feed. Components that show
      // the activity log fetch directly from the API. No store update.
      break;
    }

    case 'pnl_snapshot': {
      const d = data as {
        balance?: number;
        equity?: number;
        unrealized_pnl?: number;
      };
      if (d.balance != null) {
        const currentMarginUsed = useTradingStore.getState().account?.margin_used ?? 0;
        useTradingStore.getState().setAccount({
          balance: d.balance,
          equity: d.equity ?? 0,
          unrealized_pnl: d.unrealized_pnl ?? 0,
          margin_used: currentMarginUsed,
        });
      }
      break;
    }

    case 'error': {
      const d = data as { message?: string };
      console.error('[useSSE] Server error event:', d);
      const msg = typeof d.message === 'string' ? d.message : 'Server error';
      useTradingStore.getState().addDecision({
        timestamp: new Date().toISOString(),
        action: 'error',
        pair: null,
        reasoning: msg,
        active_pairs: [],
        calm_pairs: [],
        portfolio: {
          balance: useTradingStore.getState().account?.balance ?? 0,
          equity: useTradingStore.getState().account?.equity ?? 0,
          unrealized_pnl: useTradingStore.getState().account?.unrealized_pnl ?? 0,
          exposure_pct: 0,
        },
      });
      break;
    }

    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Hydration -- populate stores from state snapshot
// ---------------------------------------------------------------------------

function hydrateFromSnapshot(snapshot: StateSnapshot): void {
  // Trading store -- single batched hydrate call for non-setter fields,
  // then individual setters for data that needs special handling
  const tradingPatch: Record<string, unknown> = {
    engineRunning: snapshot.engineStatus.running,
    serverEpoch: snapshot.server_epoch,
  };
  if (snapshot.engineStatus.nextDecisionAt != null) {
    tradingPatch.nextDecisionAt = snapshot.engineStatus.nextDecisionAt;
  }
  if (snapshot.engineStatus.lastDecisionTime != null) {
    tradingPatch.lastDecisionTime = snapshot.engineStatus.lastDecisionTime;
  }
  if (snapshot.engineStatus.lastSyncTime != null) {
    tradingPatch.lastSyncTime = snapshot.engineStatus.lastSyncTime;
  }

  const trading = useTradingStore.getState();
  trading.hydrate(tradingPatch);
  if (snapshot.account) trading.setAccount(snapshot.account);
  if (snapshot.positions) trading.setPositions(snapshot.positions);
  if (snapshot.riskMetrics) trading.setRiskMetrics(snapshot.riskMetrics);
  if (snapshot.decisionLog) trading.setDecisionLog(snapshot.decisionLog);
  if (snapshot.activeBots) trading.setActiveBots(snapshot.activeBots);

  // Pet store
  if (snapshot.petState) {
    const ps = snapshot.petState;
    const pet = usePetStore.getState();

    pet.setVitals({
      hunger: ps.hunger,
      happiness: ps.happiness,
      energy: ps.energy,
      health: ps.health,
    });

    pet.hydrate({
      name: ps.name,
      mood: ps.mood,
      stage: ps.stage,
      cumulative_volume: ps.cumulative_volume,
      consecutive_losses: ps.consecutive_losses,
      last_trade_time: ps.last_trade_time,
      is_alive: ps.is_alive,
      evolved_at: ps.evolved_at,
    });
  }

  // Config store
  if (snapshot.config) {
    useConfigStore.getState().hydrate(snapshot.config);
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSSE(): UseSSEReturn {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clockOffset, setClockOffset] = useState(0);

  // Refs for mutable state that does not need to trigger renders
  const bufferRef = useRef<BufferedEvent[]>([]);
  const isHydratedRef = useRef(false);
  const serverEpochRef = useRef<number>(0);
  const lastSeqRef = useRef<number>(0);
  const hydrationInProgressRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    // Event buffer -- populated during the gap between EventSource open and
    // state snapshot fetch. Applied after hydration.
    bufferRef.current = [];
    isHydratedRef.current = false;
    serverEpochRef.current = 0;
    lastSeqRef.current = 0;

    // Track whether the EventSource has connected at least once.
    // Used to detect reconnections vs initial connection.
    let hasConnected = false;

    // Open EventSource FIRST to start buffering events
    const es = new EventSource(SSE_URL);

    // Connection timeout -- if the EventSource hasn't fired `open` within
    // 15 seconds, probe with a regular fetch to surface the real error
    // (e.g. 401). EventSource cannot read HTTP status codes.
    const connectionTimeout = setTimeout(() => {
      if (!hasConnected) {
        es.close();
        if (mountedRef.current) {
          setError('Server unreachable (timeout after 15s)');
          setLoading(false);
        }
      }
    }, CONNECTION_TIMEOUT_MS);

    // -----------------------------------------------------------------------
    // SSE event handlers
    // -----------------------------------------------------------------------

    function onSSEEvent(eventType: SSEEventType, messageEvent: MessageEvent): void {
      if (!mountedRef.current) return;

      let frame: SSEFrame;
      try {
        frame = JSON.parse(messageEvent.data) as SSEFrame;
      } catch {
        // Malformed data -- ignore
        return;
      }

      // If server epoch changed (server restarted), discard buffer
      if (
        serverEpochRef.current !== 0 &&
        frame.server_epoch !== serverEpochRef.current
      ) {
        bufferRef.current = [];
        return;
      }

      if (!isHydratedRef.current) {
        // Still waiting for state snapshot -- buffer the event
        if (bufferRef.current.length < BUFFER_SIZE_CAP) {
          bufferRef.current.push({ eventType, frame });
        }
        return;
      }

      // Live mode -- dispatch directly to stores
      if (frame.seq > lastSeqRef.current) {
        lastSeqRef.current = frame.seq;
        dispatchEvent(eventType, frame.data);
      }
    }

    // Register named event listeners for each event type
    for (const eventType of EVENT_TYPES) {
      es.addEventListener(eventType, (e) =>
        onSSEEvent(eventType, e as MessageEvent),
      );
    }

    // Ping -- no-op, confirms connection is alive
    es.addEventListener('ping', () => {});

    // -----------------------------------------------------------------------
    // Hydration logic
    // -----------------------------------------------------------------------

    async function runHydration(): Promise<void> {
      if (hydrationInProgressRef.current || !mountedRef.current) return;
      hydrationInProgressRef.current = true;
      isHydratedRef.current = false;

      if (mountedRef.current) setLoading(true);

      try {
        const res = await fetch(STATE_URL);

        if (!mountedRef.current) return;

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`State fetch failed: ${res.status} ${body}`);
        }

        const snapshot: StateSnapshot = await res.json();

        if (!mountedRef.current) return;

        // Detect server restart -- discard stale buffer
        if (
          serverEpochRef.current !== 0 &&
          snapshot.server_epoch !== serverEpochRef.current
        ) {
          bufferRef.current = [];
        }

        // Record boundaries
        serverEpochRef.current = snapshot.server_epoch;
        lastSeqRef.current = snapshot.lastEventSeq;

        // Compute clock offset for countdown accuracy
        const offset = snapshot.serverTime - Date.now();
        moduleClockOffset = offset;
        setClockOffset(offset);

        // Hydrate all Zustand stores from the snapshot
        hydrateFromSnapshot(snapshot);

        // Apply buffered events that arrived after the snapshot's seq boundary
        const buffer = bufferRef.current;
        bufferRef.current = [];

        // If buffer overflowed (>= cap), skip -- snapshot is authoritative
        if (buffer.length < BUFFER_SIZE_CAP) {
          const applicable = buffer
            .filter(
              (e) =>
                e.frame.seq > snapshot.lastEventSeq &&
                e.frame.server_epoch === snapshot.server_epoch,
            )
            .sort((a, b) => a.frame.seq - b.frame.seq);

          for (const { eventType, frame } of applicable) {
            lastSeqRef.current = frame.seq;
            dispatchEvent(eventType, frame.data);
          }
        }

        isHydratedRef.current = true;

        // Auto-start engine if mode is "auto" but engine isn't running
        // (handles page refresh / server restart scenarios)
        if (
          snapshot.config?.mode === 'auto' &&
          !snapshot.engineStatus?.running
        ) {
          fetch('/api/engine/start', { method: 'POST' }).catch(() => {});
        }

        if (mountedRef.current) {
          setLoading(false);
          setError(null);
        }
      } catch (err) {
        if (!mountedRef.current) return;
        const msg =
          err instanceof Error ? err.message : 'Failed to fetch state';
        setError(msg);
        setLoading(false);
      } finally {
        hydrationInProgressRef.current = false;
      }
    }

    // -----------------------------------------------------------------------
    // Connection lifecycle
    // -----------------------------------------------------------------------

    es.addEventListener('open', () => {
      if (!mountedRef.current) return;
      clearTimeout(connectionTimeout);
      setConnected(true);

      if (hasConnected) {
        // Reconnection -- re-run full hydration
        bufferRef.current = [];
        isHydratedRef.current = false;
        setLoading(true);
        runHydration();
      } else {
        // Initial connection -- start hydration
        hasConnected = true;
        runHydration();
      }
    });

    es.addEventListener('error', () => {
      if (!mountedRef.current) return;
      setConnected(false);
      // EventSource auto-reconnects. The `open` handler above will
      // trigger re-hydration on successful reconnect.
      // Do NOT clear stores -- keep old data visible until new snapshot.
    });

    // -----------------------------------------------------------------------
    // Cleanup
    // -----------------------------------------------------------------------

    return () => {
      mountedRef.current = false;
      clearTimeout(connectionTimeout);
      es.close();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { loading, connected, error, clockOffset };
}
