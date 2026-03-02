/**
 * POST /api/engine/stop
 *
 * Stop the trading engine gracefully.
 */
import { NextResponse } from 'next/server';
import { withAuth } from '@/server/middleware/auth';
import { engine } from '@/server/engine';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async (_request: Request) => {
  try {
    engine.stop();

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/engine/stop] POST error:', err);
    return NextResponse.json(
      { error: 'Failed to stop engine' },
      { status: 500 },
    );
  }
});
