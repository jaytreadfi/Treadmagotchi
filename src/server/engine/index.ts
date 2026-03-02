/**
 * TradingEngine singleton -- the top-level orchestrator for the server-side engine.
 *
 * Uses globalThis pattern for HMR safety in Next.js development.
 *
 * Responsibilities:
 * - Start/stop the scheduler and all sub-systems
 * - Bootstrap order monitor, risk manager, pet state
 * - Provide full state snapshot for SSE hydration
 * - Mutex-protected start to prevent concurrent starts
 * - Graceful degradation on unhandled errors
 */
import * as repository from '@/server/db/repository';
import * as configStore from '@/server/db/configStore';
import { sseEmitter } from '@/server/engine/sseEmitter';
import { riskManager } from '@/server/engine/riskManager';
import { dbCircuitBreaker } from '@/server/engine/dbCircuitBreaker';
import {
  startEngine as startScheduler,
  stopEngine as stopScheduler,
  triggerManualFeed as schedulerManualFeed,
  getSchedulerState,
  isLoopActive,
} from '@/server/engine/scheduler';
import {
  initPetState,
  getPetSnapshot,
} from '@/server/engine/pet/petStateMachine';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EngineStatus {
  running: boolean;
  starting: boolean;
  stopping: boolean;
  loopInProgress: boolean;
  nextDecisionAt: number | null;
  lastDecisionTime: number | null;
  lastSyncTime: number | null;
  mode: string;
  startedAt: number | null;
}

export interface FullState {
  engine: EngineStatus;
  pet: Record<string, unknown>;
  lastEventSeq: number;
  serverEpoch: number;
}

// ---------------------------------------------------------------------------
// TradingEngine class
// ---------------------------------------------------------------------------

class TradingEngine {
  private running = false;
  private starting = false;
  private stopping = false;
  private startedAt: number | null = null;

  /**
   * Start the engine -- loads config, bootstraps all sub-systems, starts scheduler.
   * Has a mutex to prevent concurrent starts from rapid API calls.
   */
  async start(): Promise<void> {
    if (this.starting || this.running) {
      console.log('[Engine] Already running or starting, ignoring start()');
      return;
    }
    this.starting = true;

    try {
      console.log('[Engine] Starting...');

      // 0. Reset circuit breaker and wire trip callback
      dbCircuitBreaker.reset();
      dbCircuitBreaker.setOnTrip(() => {
        console.error('[Engine] DB circuit breaker tripped -- stopping engine');
        this.stop();
      });

      // 1. Prune old data (retention housekeeping)
      try {
        repository.pruneOldData();
        console.log('[Engine] Data retention pruning complete');
      } catch (err) {
        console.error('[Engine] Prune error (non-fatal):', err);
      }
      if (this.stopping) { this.starting = false; return; }

      // 2. Seed risk manager from DB
      try {
        riskManager.seedFromDb();
        console.log('[Engine] Risk manager seeded from DB');
      } catch (err) {
        console.error('[Engine] Risk manager seed error (non-fatal):', err);
      }
      if (this.stopping) { this.starting = false; return; }

      // 3. Bootstrap order monitor eagerly (not lazily on first check)
      try {
        const { orderMonitor } = await import('@/server/engine/orderMonitor');
        await orderMonitor.bootstrap();
        console.log('[Engine] Order monitor bootstrapped');
      } catch (err) {
        console.error('[Engine] Order monitor bootstrap error (non-fatal):', err);
      }
      if (this.stopping) { this.starting = false; return; }

      // 4. Initialize pet state (apply offline decay)
      try {
        initPetState();
        console.log('[Engine] Pet state initialized');
      } catch (err) {
        console.error('[Engine] Pet state init error (non-fatal):', err);
      }
      if (this.stopping) { this.starting = false; return; }

      // 5. Startup reconciliation -- sync DB trade statuses against Tread API
      //    Catches bots that completed/failed while the server was down.
      try {
        const { syncBotStatuses } = await import('@/server/engine/executor');
        const reconciled = await syncBotStatuses();
        if (reconciled.length) {
          console.log(`[Engine] Startup reconciliation: ${reconciled.length} bot(s) updated`);
          // Process completed bots through pet state machine
          const { onTradeCompleted } = await import('@/server/engine/pet/petStateMachine');
          for (const r of reconciled) {
            if (r.pnl !== undefined) {
              onTradeCompleted(Number(r.pnl), Number(r.volume || 0));
            }
          }
        } else {
          console.log('[Engine] Startup reconciliation: all trades in sync');
        }
      } catch (err) {
        console.error('[Engine] Startup reconciliation error (non-fatal):', err);
      }
      if (this.stopping) { this.starting = false; return; }

      // 6. Start the scheduler (decision loop, sync loop, pet tick)
      this.running = true;
      this.stopping = false;
      this.startedAt = Date.now();
      startScheduler();

      repository.saveActivity({
        timestamp: Date.now(),
        category: 'engine',
        action: 'start',
        pair: null,
        detail: JSON.stringify({ startedAt: this.startedAt }),
      });

      console.log('[Engine] Started successfully');
      sseEmitter.emit('engine_status', this.getStatus());
    } catch (err) {
      console.error('[Engine] Start failed:', err);
      this.running = false;
      this.startedAt = null;
      throw err;
    } finally {
      this.starting = false;
    }
  }

  /**
   * Stop the engine -- stops scheduler, saves pet state, clears all timers.
   */
  stop(): void {
    if (!this.running && !this.starting) {
      console.log('[Engine] Not running, ignoring stop()');
      return;
    }

    console.log('[Engine] Stopping...');
    this.stopping = true;

    // Stop the scheduler (clears all timers, aborts in-flight loops)
    stopScheduler();

    // Save pet state one last time
    try {
      repository.updatePetState({ last_save_time: Date.now() });
    } catch (err) {
      console.error('[Engine] Pet state save error on stop:', err);
    }

    try {
      repository.saveActivity({
        timestamp: Date.now(),
        category: 'engine',
        action: 'stop',
        pair: null,
        detail: JSON.stringify({ stoppedAt: Date.now(), uptime: this.startedAt ? Date.now() - this.startedAt : 0 }),
      });
    } catch (err) {
      console.error('[Engine] Activity save error on stop:', err);
    }

    this.running = false;
    this.stopping = false;
    this.startedAt = null;

    console.log('[Engine] Stopped');
    sseEmitter.emit('engine_status', this.getStatus());
  }

  /**
   * Get the current engine status.
   */
  getStatus(): EngineStatus {
    const schedulerState = this.running ? getSchedulerState() : {
      running: false,
      loopInProgress: false,
      nextDecisionAt: null,
      lastDecisionTime: configStore.getConfig<number>('last_decision_time') ?? null,
      lastSyncTime: configStore.getConfig<number>('last_sync_time') ?? null,
    };

    return {
      running: this.running,
      starting: this.starting,
      stopping: this.stopping,
      loopInProgress: schedulerState.loopInProgress,
      nextDecisionAt: schedulerState.nextDecisionAt,
      lastDecisionTime: schedulerState.lastDecisionTime,
      lastSyncTime: schedulerState.lastSyncTime,
      mode: configStore.getConfig<string>('mode') ?? 'auto',
      startedAt: this.startedAt,
    };
  }

  /**
   * Complete state snapshot for initial SSE hydration.
   * Includes everything a newly-connected client needs.
   */
  getFullState(): FullState {
    return {
      engine: this.getStatus(),
      pet: getPetSnapshot(),
      lastEventSeq: sseEmitter.seq,
      serverEpoch: sseEmitter.serverEpoch,
    };
  }

  /**
   * Check if a trading loop is currently in progress.
   */
  isLoopInProgress(): boolean {
    return isLoopActive();
  }

  /**
   * Trigger a manual feed (manual mode: user clicks "feed" button).
   */
  async triggerManualFeed(): Promise<void> {
    await schedulerManualFeed();
  }

  /**
   * Emergency degradation -- called on unhandled errors.
   * Saves critical state to SQLite and stops trading to prevent further damage.
   */
  saveStateAndDegrade(): void {
    console.error('[Engine] DEGRADING -- saving state and stopping');

    try {
      // Save pet state
      repository.updatePetState({ last_save_time: Date.now() });
    } catch (err) {
      console.error('[Engine] Failed to save pet state during degradation:', err);
    }

    try {
      // Stop scheduler to prevent new trades
      this.stop();
    } catch (err) {
      console.error('[Engine] Failed to stop during degradation:', err);
    }

    try {
      // Log the degradation event
      repository.saveActivity({
        timestamp: Date.now(),
        category: 'error',
        action: 'engine_degraded',
        pair: null,
        detail: JSON.stringify({ reason: 'Unhandled error triggered degradation' }),
      });
    } catch (err) {
      console.error('[Engine] Failed to log degradation event:', err);
    }

    sseEmitter.emit('error', { message: 'Engine degraded due to unhandled error. Restart required.' });
  }

  /**
   * Whether the engine is in a stopping state.
   * Used by trading loop to bail early at async boundaries.
   */
  get isStopping(): boolean {
    return this.stopping;
  }

  /**
   * Whether the engine is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }
}

// ---------------------------------------------------------------------------
// globalThis singleton -- survives HMR reloads in development
// ---------------------------------------------------------------------------

const globalForEngine = globalThis as unknown as { __engine?: TradingEngine };
export const engine = globalForEngine.__engine ??= new TradingEngine();
