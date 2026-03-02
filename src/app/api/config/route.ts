/**
 * /api/config
 *
 * GET  - Return all config. Sensitive keys (API keys) show { configured: true/false } only.
 * POST - Update non-sensitive config values. Validates all values via configStore.
 */
import { NextResponse } from 'next/server';
import { withAuth } from '@/server/middleware/auth';
import { getAllConfig, getConfig, setConfig } from '@/server/db/configStore';
import { updatePetState } from '@/server/db/repository';
import { sseEmitter } from '@/server/engine/sseEmitter';

export const dynamic = 'force-dynamic';

// Keys whose values must never be returned to the client
const SENSITIVE_KEYS = [
  'treadfi_api_key',
  'anthropic_api_key',
];

// Keys that may be updated via the general config endpoint
const UPDATABLE_KEYS = [
  'pet_name',
  'mode',
  'decision_interval_seconds',
  'initial_capital',
  'accounts',
];

function redactConfig(raw: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (SENSITIVE_KEYS.includes(key)) {
      result[key] = {
        configured: value !== null && value !== undefined && value !== '',
      };
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ── GET /api/config ──

export const GET = withAuth(async (_request: Request) => {
  try {
    const raw = getAllConfig();
    return NextResponse.json(redactConfig(raw));
  } catch (err) {
    console.error('[api/config] GET error:', err);
    return NextResponse.json(
      { error: 'Failed to read config' },
      { status: 500 },
    );
  }
});

// ── POST /api/config ──

export const POST = withAuth(async (request: Request) => {
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
    // Reject attempts to set sensitive keys via this endpoint
    if (SENSITIVE_KEYS.includes(key)) {
      errors.push(`${key}: use /api/config/keys to set API keys`);
      continue;
    }

    // Reject unknown keys
    if (!UPDATABLE_KEYS.includes(key)) {
      errors.push(`${key}: unknown config key`);
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

  // If pet_name changed, sync to pet_state table and notify via SSE
  if (updated.includes('pet_name')) {
    const newName = getConfig<string>('pet_name') ?? 'Tready';
    updatePetState({ name: newName });
    sseEmitter.emit('pet_updated', { name: newName });
  }

  // If mode changed, start or stop the engine accordingly
  if (updated.includes('mode')) {
    const newMode = getConfig<string>('mode');
    try {
      const { engine } = await import('@/server/engine');
      if (newMode === 'auto') {
        await engine.start();
      } else {
        engine.stop();
      }
    } catch (err) {
      console.error('[api/config] Engine control after mode change failed:', err);
    }
  }

  return NextResponse.json({
    success: true,
    updated,
    ...(errors.length > 0 ? { warnings: errors } : {}),
  });
});
