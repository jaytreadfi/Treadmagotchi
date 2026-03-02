/**
 * POST /api/config/validate
 *
 * Validate the configured Tread API key by calling the server-side
 * treadApi.validateToken(). Rate-limited to prevent abuse.
 */
import { NextResponse } from 'next/server';
import { withAuth, rateLimit } from '@/server/middleware/auth';
import { validateToken } from '@/server/clients/treadApi';

export const dynamic = 'force-dynamic';

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

export const POST = withAuth(async (_request: Request) => {
  // Rate limiting
  const rl = rateLimit('config-validate', RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', retryAfter: rl.retryAfter },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfter) },
      },
    );
  }

  try {
    const valid = await validateToken();
    return NextResponse.json({ valid });
  } catch (err) {
    console.error('[api/config/validate] Error:', err);
    return NextResponse.json(
      {
        valid: false,
        error: err instanceof Error ? err.message : 'Validation failed',
      },
      { status: 502 },
    );
  }
});
