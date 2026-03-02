/**
 * Server-side loop scheduler -- manages all interval-based loops.
 *
 * Trading decision: dynamic (2-8 min based on drawdown)
 * Bot sync: 30s
 * Pet tick: 10s
 *
 * Key differences from client version:
 * - Config from configStore (SQLite) instead of Zustand
 * - Persists lastDecisionTime and lastSyncTime to SQLite
 * - AbortController watchdog for stuck loops (5 min timeout)
 * - Stores nextDecisionAt as absolute timestamp for countdown UI
 * - Minimum 60-second cooldown between Claude API calls
 * - Emits engine_status SSE events after decisions and on start/stop
 */
import { BOT_SYNC_INTERVAL_MS } from '@/lib/constants';
import * as configStore from '@/server/db/configStore';
import { sseEmitter } from '@/server/engine/sseEmitter';

// ---------------------------------------------------------------------------
// Lazy imports -- resolved at first use to avoid circular dependency issues.
// The trading engine and pet state machine import from modules that may
// import the scheduler indirectly.
// ---------------------------------------------------------------------------

type RunTradingLoopFn = (signal?: AbortSignal) => Promise<void>;
type RunStatusSyncFn = () => Promise<void>;
type TickPetStateFn = (engineRunning: boolean) => void;

let _runTradingLoop: RunTradingLoopFn | null = null;
let _runStatusSync: RunStatusSyncFn | null = null;
let _tickPetState: TickPetStateFn | null = null;

async function getRunTradingLoop(): Promise<RunTradingLoopFn> {
  if (!_runTradingLoop) {
    const mod = await import('@/server/engine/tradingEngine');
    _runTradingLoop = mod.runTradingLoop;
  }
  return _runTradingLoop;
}

async function getRunStatusSync(): Promise<RunStatusSyncFn> {
  if (!_runStatusSync) {
    const mod = await import('@/server/engine/tradingEngine');
    _runStatusSync = mod.runStatusSync;
  }
  return _runStatusSync;
}

async function getTickPetState(): Promise<TickPetStateFn> {
  if (!_tickPetState) {
    const mod = await import('@/server/engine/pet/petStateMachine');
    _tickPetState = mod.tickPetState;
  }
  return _tickPetState;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let decisionTimer: ReturnType<typeof setTimeout> | null = null;
let syncTimer: ReturnType<typeof setInterval> | null = null;
let petTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let loopInProgress = false;
let loopController: AbortController | null = null;

/** Absolute epoch ms when the next decision will fire. */
let nextDecisionAt: number | null = null;

/** Last time a Claude API call was made (for cooldown enforcement). */
let lastClaudeCallTime = 0;

// Dynamic interval bounds (ms)
const MIN_INTERVAL_MS = 2 * 60 * 1000;   // 2 min (volatile)
const MAX_INTERVAL_MS = 8 * 60 * 1000;   // 8 min (calm)
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 min (default)
const WATCHDOG_TIMEOUT_MS = 5 * 60 * 1000; // 5 min watchdog
const MIN_CLAUDE_COOLDOWN_MS = 60 * 1000;  // 60s between Claude calls

// ---------------------------------------------------------------------------
// Adaptive interval
// ---------------------------------------------------------------------------

function getAdaptiveInterval(): number {
  const configInterval = (configStore.getConfig<number>('decision_interval_seconds') || 300) * 1000;
  const baseline = configInterval || DEFAULT_INTERVAL_MS;

  // Check risk state for drawdown -- if elevated, decide faster
  // We read the last known drawdown from configStore (set by trading engine)
  const lastDrawdown = configStore.getConfig<number>('last_drawdown_pct') ?? 0;
  if (lastDrawdown > 0.05) {
    return Math.max(MIN_INTERVAL_MS, baseline * 0.5);
  }

  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, baseline));
}

// ---------------------------------------------------------------------------
// Watchdog-protected loop execution
// ---------------------------------------------------------------------------

async function runWithWatchdog(): Promise<void> {
  loopController = new AbortController();
  const watchdog = setTimeout(() => {
    loopController?.abort();
    loopInProgress = false;
    console.error('[Scheduler] Trading loop exceeded 5min -- aborted');
    emitStatus();
  }, WATCHDOG_TIMEOUT_MS);

  try {
    // Enforce minimum Claude API cooldown
    const now = Date.now();
    const sinceLast = now - lastClaudeCallTime;
    if (sinceLast < MIN_CLAUDE_COOLDOWN_MS) {
      const waitMs = MIN_CLAUDE_COOLDOWN_MS - sinceLast;
      console.log(`[Scheduler] Claude cooldown: waiting ${(waitMs / 1000).toFixed(0)}s`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    lastClaudeCallTime = Date.now();
    const runTradingLoop = await getRunTradingLoop();
    await runTradingLoop(loopController.signal);

    // Persist last decision time
    configStore.setConfig('last_decision_time', Date.now());
  } finally {
    clearTimeout(watchdog);
    loopInProgress = false;
    loopController = null;
  }
}

// ---------------------------------------------------------------------------
// Decision scheduling
// ---------------------------------------------------------------------------

function scheduleNextDecision(): void {
  if (!isRunning) return;

  const interval = getAdaptiveInterval();
  nextDecisionAt = Date.now() + interval;

  emitStatus();

  decisionTimer = setTimeout(async () => {
    const mode = configStore.getConfig<string>('mode') ?? 'auto';
    if (mode === 'auto' && !loopInProgress) {
      loopInProgress = true;
      try {
        await runWithWatchdog();
      } catch (err) {
        console.error('[Scheduler] Decision loop error:', err);
        loopInProgress = false;
      }
      emitStatus();
    }
    scheduleNextDecision(); // Schedule next with fresh interval
  }, interval);
}

// ---------------------------------------------------------------------------
// SSE status emission
// ---------------------------------------------------------------------------

function emitStatus(): void {
  sseEmitter.emit('engine_status', {
    running: isRunning,
    loopInProgress,
    nextDecisionAt,
    lastDecisionTime: configStore.getConfig<number>('last_decision_time') ?? null,
    lastSyncTime: configStore.getConfig<number>('last_sync_time') ?? null,
    mode: configStore.getConfig<string>('mode') ?? 'auto',
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startEngine(): void {
  if (isRunning) return;
  isRunning = true;

  const interval = getAdaptiveInterval();
  console.log(`[Scheduler] Engine starting -- initial interval: ${(interval / 1000).toFixed(0)}s (adaptive)`);

  // Check elapsed time since last decision -- maybe we should run immediately
  const lastDecisionTime = configStore.getConfig<number>('last_decision_time') ?? 0;
  const elapsed = Date.now() - lastDecisionTime;
  const shouldRunNow = elapsed >= interval || lastDecisionTime === 0;

  if (shouldRunNow && !loopInProgress) {
    loopInProgress = true;
    runWithWatchdog()
      .catch((err) => {
        console.error('[Scheduler] Initial loop error:', err);
        loopInProgress = false;
      })
      .finally(() => {
        emitStatus();
        scheduleNextDecision();
      });
  } else {
    // Schedule based on remaining time
    const remaining = Math.max(0, interval - elapsed);
    nextDecisionAt = Date.now() + remaining;

    decisionTimer = setTimeout(async () => {
      const mode = configStore.getConfig<string>('mode') ?? 'auto';
      if (mode === 'auto' && !loopInProgress) {
        loopInProgress = true;
        try {
          await runWithWatchdog();
        } catch (err) {
          console.error('[Scheduler] Decision loop error:', err);
          loopInProgress = false;
        }
        emitStatus();
      }
      scheduleNextDecision();
    }, remaining);
  }

  // Bot status sync every 30s
  getRunStatusSync().then((runStatusSync) => {
    if (!isRunning) return; // Engine stopped while resolving
    syncTimer = setInterval(async () => {
      try {
        await runStatusSync();
        configStore.setConfig('last_sync_time', Date.now());
      } catch (err) {
        console.error('[Scheduler] Sync error:', err);
      }
    }, BOT_SYNC_INTERVAL_MS);
  });

  // Pet state tick every 10s
  getTickPetState().then((tickPetState) => {
    if (!isRunning) return; // Engine stopped while resolving
    petTimer = setInterval(() => {
      try {
        tickPetState(isRunning);
      } catch (err) {
        console.error('[Scheduler] Pet tick error:', err);
      }
    }, 10_000);
  });

  emitStatus();
  console.log('[Scheduler] Engine started');
}

export function stopEngine(): void {
  if (!isRunning) return;
  isRunning = false;

  if (decisionTimer) { clearTimeout(decisionTimer); decisionTimer = null; }
  if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
  if (petTimer) { clearInterval(petTimer); petTimer = null; }

  // Abort any in-progress loop
  if (loopController) {
    loopController.abort();
    loopController = null;
  }

  nextDecisionAt = null;

  emitStatus();
  console.log('[Scheduler] Engine stopped');
}

/**
 * Manual mode: trigger a single trading loop run (user "feeds" pet).
 */
export async function triggerManualFeed(): Promise<void> {
  console.log('[Scheduler] Manual feed triggered');
  if (loopInProgress) {
    console.log('[Scheduler] Loop already in progress, skipping manual feed');
    return;
  }
  loopInProgress = true;
  try {
    await runWithWatchdog();
  } catch (err) {
    console.error('[Scheduler] Manual feed error:', err);
    loopInProgress = false;
  }
  emitStatus();
}

/**
 * Return the current scheduler state for API responses / SSE hydration.
 */
export function getSchedulerState(): {
  running: boolean;
  loopInProgress: boolean;
  nextDecisionAt: number | null;
  lastDecisionTime: number | null;
  lastSyncTime: number | null;
} {
  return {
    running: isRunning,
    loopInProgress,
    nextDecisionAt,
    lastDecisionTime: configStore.getConfig<number>('last_decision_time') ?? null,
    lastSyncTime: configStore.getConfig<number>('last_sync_time') ?? null,
  };
}

/**
 * Check if a trading loop is currently in progress.
 */
export function isLoopActive(): boolean {
  return loopInProgress;
}

/**
 * Check if the engine is running.
 */
export function isEngineRunning(): boolean {
  return isRunning;
}
