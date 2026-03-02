/**
 * SSE event broadcaster — central pub/sub for server-to-client events.
 *
 * Uses Node.js EventEmitter under the hood. HMR-safe via globalThis pattern.
 * Includes monotonic sequence numbers and server_epoch for gap detection
 * and restart awareness on the client side.
 */
import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SSEEventType =
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

export interface SSEEvent {
  type: SSEEventType;
  data: unknown;
  seq: number;
  server_epoch: number;
}

// ---------------------------------------------------------------------------
// SSEEmitter class
// ---------------------------------------------------------------------------

const INTERNAL_EVENT = '__sse_event__';
const PET_THROTTLE_MS = 5_000;

class SSEEmitter {
  private emitter: EventEmitter;
  private _seq: number;
  private _serverEpoch: number;
  private _lastPetEmitTime: number;
  private _pendingPetData: unknown | null;
  private _petThrottleTimer: ReturnType<typeof setTimeout> | null;

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(50);
    this._seq = 0;
    this._serverEpoch = Date.now();
    this._lastPetEmitTime = 0;
    this._pendingPetData = null;
    this._petThrottleTimer = null;
  }

  /** Current monotonic sequence number (useful for snapshot boundaries). */
  get seq(): number {
    return this._seq;
  }

  /** Timestamp set once when this emitter was created (i.e. process start). */
  get serverEpoch(): number {
    return this._serverEpoch;
  }

  /**
   * Emit an event to all subscribers. Wraps data with seq and server_epoch.
   *
   * `pet_updated` events are throttled to max 1 per 5 seconds.
   * If a pet_updated event arrives during the throttle window, it is
   * buffered and emitted when the window expires (last-write-wins).
   */
  emit(type: SSEEventType, data: unknown): void {
    if (type === 'pet_updated') {
      this._emitPetThrottled(data);
      return;
    }

    this._emitImmediate(type, data);
  }

  /**
   * Subscribe to all SSE events. Returns an unsubscribe function.
   */
  subscribe(handler: (event: SSEEvent) => void): () => void {
    this.emitter.on(INTERNAL_EVENT, handler);
    return () => {
      this.emitter.off(INTERNAL_EVENT, handler);
    };
  }

  /** Number of active listeners. */
  get listenerCount(): number {
    return this.emitter.listenerCount(INTERNAL_EVENT);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _emitImmediate(type: SSEEventType, data: unknown): void {
    this._seq += 1;
    const event: SSEEvent = {
      type,
      data,
      seq: this._seq,
      server_epoch: this._serverEpoch,
    };
    this.emitter.emit(INTERNAL_EVENT, event);
  }

  private _emitPetThrottled(data: unknown): void {
    const now = Date.now();
    const elapsed = now - this._lastPetEmitTime;

    if (elapsed >= PET_THROTTLE_MS) {
      // Outside throttle window -- emit immediately
      this._lastPetEmitTime = now;
      this._pendingPetData = null;
      if (this._petThrottleTimer !== null) {
        clearTimeout(this._petThrottleTimer);
        this._petThrottleTimer = null;
      }
      this._emitImmediate('pet_updated', data);
    } else {
      // Inside throttle window -- buffer (last-write-wins)
      this._pendingPetData = data;
      if (this._petThrottleTimer === null) {
        const remainingMs = PET_THROTTLE_MS - elapsed;
        this._petThrottleTimer = setTimeout(() => {
          this._petThrottleTimer = null;
          if (this._pendingPetData !== null) {
            this._lastPetEmitTime = Date.now();
            const pending = this._pendingPetData;
            this._pendingPetData = null;
            this._emitImmediate('pet_updated', pending);
          }
        }, remainingMs);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// HMR-safe singleton
// ---------------------------------------------------------------------------

const globalForSSE = globalThis as unknown as { __sseEmitter?: SSEEmitter };
export const sseEmitter: SSEEmitter = globalForSSE.__sseEmitter ??= new SSEEmitter();
