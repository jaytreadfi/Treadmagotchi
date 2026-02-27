import { NextRequest, NextResponse } from 'next/server';

const TV_SCANNER_URL = 'https://scanner.tradingview.com/crypto/scan';

/**
 * Proxy to TradingView scanner API.
 * POST body should contain the scan request (symbols + columns).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.text();

    const response = await fetch(TV_SCANNER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      body,
    });
    const data = await response.text();

    return new NextResponse(data, {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Proxy error: ${error instanceof Error ? error.message : 'Unknown'}` },
      { status: 502 },
    );
  }
}
