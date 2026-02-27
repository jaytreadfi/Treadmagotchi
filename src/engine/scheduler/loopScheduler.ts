/**
 * Loop scheduler — manages all interval-based loops.
 * Trading decision: dynamic (2-8min based on market), Bot sync: 30s, Pet tick: 10s.
 */
import { runTradingLoop, runStatusSync } from '@/engine/trading/tradingEngine';
import { tickPetState } from '@/engine/pet/petStateMachine';
import { BOT_SYNC_INTERVAL_MS } from '@/lib/constants';
import { useTradingStore } from '@/store/useTradingStore';
import { useConfigStore } from '@/store/useConfigStore';

let decisionTimer: ReturnType<typeof setTimeout> | null = null;
let syncTimer: ReturnType<typeof setInterval> | null = null;
let petTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let loopInProgress = false;

// Dynamic interval bounds (ms)
const MIN_INTERVAL_MS = 2 * 60 * 1000;   // 2 min (volatile)
const MAX_INTERVAL_MS = 8 * 60 * 1000;   // 8 min (calm)
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 min (default)

/** Compute next decision interval based on market volatility. */
function getAdaptiveInterval(): number {
  const configInterval = (useConfigStore.getState().decision_interval_seconds || 300) * 1000;
  const store = useTradingStore.getState();

  // If user set a custom interval, respect it as baseline but still adapt
  const baseline = configInterval || DEFAULT_INTERVAL_MS;

  // Check active positions for volatility signals
  const positions = store.positions || [];
  if (!positions.length) return baseline; // No positions = use default

  // Check risk metrics for volatility hint
  const metrics = store.riskMetrics;
  if (!metrics) return baseline;

  // If drawdown is elevated, check more frequently
  if (metrics.drawdown_pct > 0.05) {
    return Math.max(MIN_INTERVAL_MS, baseline * 0.5);
  }

  // Use configurable baseline otherwise
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, baseline));
}

function scheduleNextDecision(): void {
  if (!isRunning) return;
  const interval = getAdaptiveInterval();
  decisionTimer = setTimeout(async () => {
    const mode = useConfigStore.getState().mode;
    if (mode === 'auto' && !loopInProgress) {
      loopInProgress = true;
      try { await runTradingLoop(); } finally { loopInProgress = false; }
    }
    scheduleNextDecision(); // Schedule next with fresh interval
  }, interval);
}

export function startEngine(): void {
  if (isRunning) return;
  isRunning = true;

  useTradingStore.getState().setEngineRunning(true);

  const interval = getAdaptiveInterval();
  console.log(`[Scheduler] Engine starting — initial interval: ${(interval / 1000).toFixed(0)}s (adaptive)`);

  // Run immediately, then schedule dynamically
  if (!loopInProgress) {
    loopInProgress = true;
    runTradingLoop().finally(() => { loopInProgress = false; scheduleNextDecision(); });
  } else {
    scheduleNextDecision();
  }

  // Bot status sync every 30s
  syncTimer = setInterval(runStatusSync, BOT_SYNC_INTERVAL_MS);

  // Pet state tick every 10s
  petTimer = setInterval(tickPetState, 10_000);

  console.log('[Scheduler] Engine started');
}

export function stopEngine(): void {
  if (!isRunning) return;
  isRunning = false;

  if (decisionTimer) { clearTimeout(decisionTimer); decisionTimer = null; }
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
