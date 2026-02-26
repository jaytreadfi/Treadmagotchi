import { NextRequest, NextResponse } from 'next/server';

const HL_API_URL = 'https://api.hyperliquid.xyz/info';

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();

    const response = await fetch(HL_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
