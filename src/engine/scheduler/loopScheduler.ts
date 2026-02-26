/**
 * Loop scheduler — manages all interval-based loops.
 * Trading decision: 5min, Bot sync: 30s, Pet tick: 10s.
 */
import { runTradingLoop, runStatusSync } from '@/engine/trading/tradingEngine';
import { tickPetState } from '@/engine/pet/petStateMachine';
import { BOT_SYNC_INTERVAL_MS } from '@/lib/constants';
import { useTradingStore } from '@/store/useTradingStore';
import { useConfigStore } from '@/store/useConfigStore';

let decisionTimer: ReturnType<typeof setInterval> | null = null;
let syncTimer: ReturnType<typeof setInterval> | null = null;
let petTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

export function startEngine(): void {
  if (isRunning) return;
  isRunning = true;

  useTradingStore.getState().setEngineRunning(true);

  // Read interval fresh from config
  const interval = (useConfigStore.getState().decision_interval_seconds || 300) * 1000;

  console.log(`[Scheduler] Engine starting — decision interval: ${interval / 1000}s`);

  // Run immediately, then on interval
  runTradingLoop();
  decisionTimer = setInterval(() => {
    // Read mode fresh each tick (no stale closure)
    const mode = useConfigStore.getState().mode;
    if (mode === 'auto') {
      runTradingLoop();
    }
  }, interval);

  // Bot status sync every 30s
  syncTimer = setInterval(runStatusSync, BOT_SYNC_INTERVAL_MS);

  // Pet state tick every 10s
  petTimer = setInterval(tickPetState, 10_000);

  console.log('[Scheduler] Engine started');
}

export function stopEngine(): void {
  if (!isRunning) return;
  isRunning = false;

  if (decisionTimer) { clearInterval(decisionTimer); decisionTimer = null; }
  if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
  if (petTimer) { clearInterval(petTimer); petTimer = null; }

  useTradingStore.getState().setEngineRunning(false);
  console.log('[Scheduler] Engine stopped');
}

export function isEngineRunning(): boolean {
  return isRunning;
}

/** Manual mode: trigger a single trading loop run (user "feeds" pet). */
export async function triggerManualFeed(): Promise<void> {
  console.log('[Scheduler] Manual feed triggered');
  await runTradingLoop();
}
