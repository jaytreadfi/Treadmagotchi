/**
 * GET /api/health
 *
 * Lightweight health check endpoint for PM2 / load balancer probes.
 * No authentication required.
 */
import { NextResponse } from 'next/server';
import { validateHost } from '@/server/middleware/auth';
import { db } from '@/server/db/index';
import { config } from '@/server/db/schema';

export const dynamic = 'force-dynamic';

const startTime = Date.now();

export async function GET(request: Request): Promise<NextResponse> {
  if (!validateHost(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let dbStatus = 'ok';

  try {
    // Simple query to verify database connectivity
    db.select().from(config).limit(1).all();
  } catch {
    dbStatus = 'error';
  }

  const uptime = Math.floor((Date.now() - startTime) / 1000);

  const status = dbStatus === 'ok' ? 'ok' : 'degraded';
  const httpStatus = dbStatus === 'ok' ? 200 : 503;

  return NextResponse.json(
    {
      status,
      db: dbStatus,
      uptime,
    },
    { status: httpStatus },
  );
}
