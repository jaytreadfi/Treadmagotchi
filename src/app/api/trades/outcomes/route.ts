/**
 * GET /api/trades/outcomes
 *
 * Fetch recent trade outcomes (win/loss/breakeven).
 * Query params: limit (default 20).
 */
import { NextResponse } from 'next/server';
import { withAuth } from '@/server/middleware/auth';
import { getTradeOutcomes } from '@/server/db/repository';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (request: Request) => {
  try {
    const url = new URL(request.url);
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 20, 1), 200) : 20;

    const outcomes = getTradeOutcomes(limit);

    return NextResponse.json({ outcomes });
  } catch (err) {
    console.error('[api/trades/outcomes] GET error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch trade outcomes' },
      { status: 500 },
    );
  }
});
