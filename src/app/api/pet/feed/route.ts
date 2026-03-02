/**
 * POST /api/pet/feed
 *
 * Trigger a manual trading loop ("feed" the pet).
 * Only works when mode is 'manual'. Rate-limited to 1 request per minute.
 */
import { NextResponse } from 'next/server';
import { withAuth, rateLimit } from '@/server/middleware/auth';
import { getConfig } from '@/server/db/configStore';
import { saveActivity } from '@/server/db/repository';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async (_request: Request) => {
  // Rate limit: 1 per minute
  const rl = rateLimit('pet-feed', 1, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limited. You can feed again shortly.', retryAfter: rl.retryAfter },
      { status: 429 },
    );
  }

  try {
    // Check mode
    const mode = getConfig<string>('mode') || 'auto';
    if (mode !== 'manual') {
      return NextResponse.json(
        { error: 'Feed is only available in manual mode. Current mode: ' + mode },
        { status: 400 },
      );
    }

    // Log the manual feed trigger
    saveActivity({
      timestamp: Date.now(),
      category: 'engine',
      action: 'manual_feed',
      pair: null,
      detail: JSON.stringify({ triggeredAt: Date.now() }),
    });

    const { engine } = await import('@/server/engine/index');
    if (!engine.isRunning()) {
      return NextResponse.json(
        { error: 'Engine is not running' },
        { status: 503 },
      );
    }

    await engine.triggerManualFeed();

    return NextResponse.json({
      success: true,
      message: 'Manual feed triggered',
    });
  } catch (err) {
    console.error('[api/pet/feed] POST error:', err);
    return NextResponse.json(
      { error: 'Failed to trigger manual feed' },
      { status: 500 },
    );
  }
});
