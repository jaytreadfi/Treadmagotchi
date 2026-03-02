/**
 * POST /api/config/onboard
 *
 * Complete onboarding in a single request:
 * - Save API keys
 * - Save accounts list
 * - Save pet name
 * - Set onboarded = true
 * - Initialize pet state
 */
import { NextResponse } from 'next/server';
import { withAuth } from '@/server/middleware/auth';
import { setConfig } from '@/server/db/configStore';
import { sqlite } from '@/server/db/index';
import { initPetState } from '@/server/db/repository';

export const dynamic = 'force-dynamic';

interface OnboardPayload {
  treadfi_api_key: string;
  anthropic_api_key: string;
  accounts: Array<{
    name: string;
    id: string;
    exchange: string;
    enabled: boolean;
  }>;
  pet_name: string;
}

export const POST = withAuth(async (request: Request) => {
  let body: OnboardPayload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  // Validate required fields are present
  const required: (keyof OnboardPayload)[] = [
    'treadfi_api_key',
    'anthropic_api_key',
    'accounts',
    'pet_name',
  ];

  const missing = required.filter((key) => !(key in body));
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing required fields: ${missing.join(', ')}` },
      { status: 400 },
    );
  }

  // Write all config values atomically -- rolls back if any validation fails.
  const configEntries: Array<[string, unknown]> = [
    ['treadfi_api_key', body.treadfi_api_key],
    ['anthropic_api_key', body.anthropic_api_key],
    ['accounts', body.accounts],
    ['pet_name', body.pet_name],
    ['onboarded', true],
  ];

  try {
    sqlite.transaction(() => {
      for (const [key, value] of configEntries) {
        setConfig(key, value);
      }
    })();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'validation failed';
    return NextResponse.json(
      { error: 'Onboarding validation failed', details: [msg] },
      { status: 400 },
    );
  }

  // Initialize pet state with the chosen name
  try {
    initPetState(body.pet_name);
  } catch (err) {
    console.error('[api/config/onboard] Failed to init pet state:', err);
    return NextResponse.json(
      { error: 'Failed to initialize pet state' },
      { status: 500 },
    );
  }

  try {
    const { engine } = await import('@/server/engine/index');
    await engine.start();
  } catch (err) {
    console.error('[api/config/onboard] Engine start failed:', err);
  }

  return NextResponse.json({ success: true });
});
