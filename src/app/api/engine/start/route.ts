/**
 * POST /api/engine/start
 *
 * Start the trading engine. Rate-limited to 1 request per 10 seconds.
 */
import { NextResponse } from 'next/server';
import { withAuth, rateLimit } from '@/server/middleware/auth';
import { engine } from '@/server/engine';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async (_request: Request) => {
  const rl = rateLimit('engine-start', 1, 10_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limited', retryAfter: rl.retryAfter },
      { status: 429 },
    );
  }

  try {
    await engine.start();

    return NextResponse.json({
      success: true,
      status: engine.getStatus(),
    });
  } catch (err) {
    console.error('[api/engine/start] POST error:', err);
    return NextResponse.json(
      { error: 'Failed to start engine' },
      { status: 500 },
    );
  }
});
