/**
 * POST /api/engine/emergency-stop
 *
 * Emergency stop: halt engine + pause all active bots.
 * Idempotent -- does not error if already stopped.
 * Uses Promise.allSettled for bot pausing, reports partial failures.
 */
import { NextResponse } from 'next/server';
import { withAuth } from '@/server/middleware/auth';
import { engine } from '@/server/engine';
import { getActiveMmBots, pauseMultiOrder } from '@/server/clients/treadApi';
import { saveActivity } from '@/server/db/repository';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async (_request: Request) => {
  try {
    // 1. Stop the engine (idempotent -- no-op if already stopped)
    try {
      engine.stop();
    } catch (err) {
      console.error('[api/engine/emergency-stop] engine.stop() failed, continuing with bot pausing:', err);
    }

    // 2. Fetch and pause all active bots
    let bots: Array<Record<string, unknown>> = [];
    let botFetchFailed = false;
    try {
      bots = await getActiveMmBots();
    } catch (err) {
      botFetchFailed = true;
      console.error('[api/engine/emergency-stop] Failed to fetch active bots:', err);
    }

    const pauseResults: Array<{ botId: string; status: 'paused' | 'failed'; error?: string }> = [];

    if (bots.length > 0) {
      const settledResults = await Promise.allSettled(
        bots.map(async (bot) => {
          const botId = String(bot.id || '');
          if (!botId) throw new Error('Bot has no ID');
          await pauseMultiOrder(botId);
          return botId;
        }),
      );

      for (let i = 0; i < settledResults.length; i++) {
        const result = settledResults[i];
        const botId = String(bots[i].id || `unknown-${i}`);

        if (result.status === 'fulfilled') {
          pauseResults.push({ botId: result.value, status: 'paused' });
        } else {
          const errorMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
          pauseResults.push({ botId, status: 'failed', error: errorMsg });
          console.error(`[api/engine/emergency-stop] Failed to pause bot ${botId}:`, errorMsg);
        }
      }
    }

    const paused = pauseResults.filter((r) => r.status === 'paused').length;
    const failed = pauseResults.filter((r) => r.status === 'failed').length;

    // Log the emergency stop
    saveActivity({
      timestamp: Date.now(),
      category: 'engine',
      action: 'emergency_stop',
      pair: null,
      detail: JSON.stringify({
        bots_found: bots.length,
        bots_paused: paused,
        bots_failed: failed,
        results: pauseResults,
      }),
    });

    return NextResponse.json({
      success: true,
      engine_stopped: true,
      bots_found: bots.length,
      bots_paused: paused,
      bots_failed: failed,
      ...(botFetchFailed ? {
        bot_fetch_failed: true,
        warning: 'Could not fetch active bots from Tread API — bots may still be running. Check app.tread.fi manually.',
      } : {}),
      ...(failed > 0 ? { failures: pauseResults.filter((r) => r.status === 'failed') } : {}),
    });
  } catch (err) {
    console.error('[api/engine/emergency-stop] POST error:', err);
    return NextResponse.json(
      { error: 'Emergency stop encountered an error' },
      { status: 500 },
    );
  }
});
