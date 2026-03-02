/**
 * POST /api/config/keys
 *
 * Set API keys (treadfi_api_key, anthropic_api_key).
 * Rate-limited to 5 requests per minute.
 */
import { NextResponse } from 'next/server';
import { withAuth, rateLimit } from '@/server/middleware/auth';
import { setConfig } from '@/server/db/configStore';

export const dynamic = 'force-dynamic';

const ALLOWED_KEYS = ['treadfi_api_key', 'anthropic_api_key'];
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

export const POST = withAuth(async (request: Request) => {
  // Rate limiting
  const rl = rateLimit('config-keys', RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', retryAfter: rl.retryAfter },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfter) },
      },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json(
      { error: 'Request body must be a JSON object' },
      { status: 400 },
    );
  }

  const errors: string[] = [];
  const updated: string[] = [];

  for (const [key, value] of Object.entries(body)) {
    if (!ALLOWED_KEYS.includes(key)) {
      errors.push(`${key}: not an API key field. Allowed: ${ALLOWED_KEYS.join(', ')}`);
      continue;
    }

    try {
      setConfig(key, value);
      updated.push(key);
    } catch (err) {
      errors.push(`${key}: ${err instanceof Error ? err.message : 'validation failed'}`);
    }
  }

  if (errors.length > 0 && updated.length === 0) {
    return NextResponse.json(
      { error: 'Validation failed', details: errors },
      { status: 400 },
    );
  }

  return NextResponse.json({
    success: true,
    updated,
    ...(errors.length > 0 ? { warnings: errors } : {}),
  });
});
