/**
 * POST /api/config/accounts/refresh
 *
 * Refresh the accounts list from the Tread API (server-side).
 * Fetches valid, non-archived accounts and returns them.
 * Does NOT automatically overwrite the stored accounts config --
 * the client should review and POST to /api/config to persist.
 */
import { NextResponse } from 'next/server';
import { withAuth } from '@/server/middleware/auth';
import { getAccounts } from '@/server/clients/treadApi';

export const dynamic = 'force-dynamic';

export const POST = withAuth(async (_request: Request) => {
  try {
    const accounts = await getAccounts();

    if (accounts.length === 0) {
      return NextResponse.json(
        {
          accounts: [],
          warning: 'No valid accounts found. Check your Tread API key.',
        },
        { status: 200 },
      );
    }

    return NextResponse.json({ accounts });
  } catch (err) {
    console.error('[api/config/accounts/refresh] Error:', err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Failed to fetch accounts',
      },
      { status: 502 },
    );
  }
});
