/**
 * DB Circuit Breaker -- halts the engine if consecutive SQLite writes fail.
 *
 * Tracks consecutive write failures across the engine. If more than
 * MAX_CONSECUTIVE_FAILURES writes fail in a row, the circuit opens
 * and the engine is stopped to prevent data loss or corruption.
 *
 * Usage:
 *   import { dbCircuitBreaker } from './dbCircuitBreaker';
 *   try { repository.updatePetState(...); dbCircuitBreaker.recordSuccess(); }
 *   catch (err) { dbCircuitBreaker.recordFailure(err); }
 */

const MAX_CONSECUTIVE_FAILURES = 5;

class DbCircuitBreaker {
  private consecutiveFailures = 0;
  private isOpen = false;
  private onTripCallback: (() => void) | null = null;

  /**
   * Register a callback that fires when the circuit trips (engine should stop).
   * This avoids a circular dependency with the engine singleton.
   */
  setOnTrip(callback: () => void): void {
    this.onTripCallback = callback;
  }

  /** Record a successful DB write -- resets the failure counter. */
  recordSuccess(): void {
    if (this.consecutiveFailures > 0) {
      this.consecutiveFailures = 0;
    }
  }

  /**
   * Record a failed DB write. If consecutive failures exceed the threshold,
   * the circuit opens and the engine is halted.
   */
  recordFailure(error: unknown): void {
    this.consecutiveFailures++;
    console.error(
      `[DbCircuitBreaker] Write failure #${this.consecutiveFailures}:`,
      error instanceof Error ? error.message : error,
    );

    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && !this.isOpen) {
      this.isOpen = true;
      console.error(
        `[DbCircuitBreaker] CIRCUIT OPEN -- ${this.consecutiveFailures} consecutive DB write failures. Halting engine.`,
      );

      if (this.onTripCallback) {
        try {
          this.onTripCallback();
        } catch (err) {
          console.error('[DbCircuitBreaker] Failed to execute trip callback:', err);
        }
      }
    }
  }

  /** Whether the circuit is currently open (engine should not trade). */
  get tripped(): boolean {
    return this.isOpen;
  }

  /** Reset the circuit breaker (e.g., on manual engine restart). */
  reset(): void {
    this.consecutiveFailures = 0;
    this.isOpen = false;
  }

  /** Current consecutive failure count (for diagnostics). */
  get failures(): number {
    return this.consecutiveFailures;
  }
}

// ---------------------------------------------------------------------------
// globalThis singleton -- survives HMR reloads in development
// ---------------------------------------------------------------------------

const GLOBAL_KEY = '__treadmagotchi_db_circuit_breaker__';

function getOrCreate(): DbCircuitBreaker {
  const g = globalThis as unknown as Record<string, DbCircuitBreaker | undefined>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new DbCircuitBreaker();
  }
  return g[GLOBAL_KEY]!;
}

export const dbCircuitBreaker = getOrCreate();
