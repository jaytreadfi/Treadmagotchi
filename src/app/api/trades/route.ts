/**
 * GET /api/trades
 *
 * Fetch trades with cursor-based pagination.
 * Query params: limit (default 50), before (cursor timestamp, optional).
 */
import { NextResponse } from 'next/server';
import { withAuth } from '@/server/middleware/auth';
import { getTradesWithPnl } from '@/server/db/repository';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (request: Request) => {
  try {
    const url = new URL(request.url);
    const limitParam = url.searchParams.get('limit');
    const beforeParam = url.searchParams.get('before');
    const beforeIdParam = url.searchParams.get('beforeId');

    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 200) : 50;
    const before = beforeParam ? parseInt(beforeParam, 10) : undefined;
    const beforeId = beforeIdParam ? parseInt(beforeIdParam, 10) : undefined;

    if (before !== undefined && isNaN(before)) {
      return NextResponse.json({ error: 'Invalid "before" parameter' }, { status: 400 });
    }
    if (beforeId !== undefined && isNaN(beforeId)) {
      return NextResponse.json({ error: 'Invalid "beforeId" parameter' }, { status: 400 });
    }

    const trades = getTradesWithPnl(limit, before, beforeId);

    // Provide composite cursor for next page (timestamp + id)
    const lastTrade = trades.length === limit && trades.length > 0
      ? trades[trades.length - 1]
      : null;

    return NextResponse.json({
      trades,
      cursor: lastTrade ? lastTrade.timestamp : null,
      cursorId: lastTrade ? lastTrade.id : null,
    });
  } catch (err) {
    console.error('[api/trades] GET error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch trades' },
      { status: 500 },
    );
  }
});
