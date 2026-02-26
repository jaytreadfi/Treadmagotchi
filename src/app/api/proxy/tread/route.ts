import { NextRequest, NextResponse } from 'next/server';
import { WAF_USER_AGENT } from '@/lib/constants';

const TREAD_BASE = 'https://app.tread.fi';

export async function GET(req: NextRequest) {
  return proxyRequest(req, 'GET');
}

export async function POST(req: NextRequest) {
  return proxyRequest(req, 'POST');
}

export async function DELETE(req: NextRequest) {
  return proxyRequest(req, 'DELETE');
}

async function proxyRequest(req: NextRequest, method: string) {
  const { searchParams } = new URL(req.url);
  const path = searchParams.get('path');
  if (!path) {
    return NextResponse.json({ error: 'Missing path parameter' }, { status: 400 });
  }

  const token = req.headers.get('x-tread-token');
  if (!token) {
    return NextResponse.json({ error: 'Missing x-tread-token header' }, { status: 401 });
  }

  // Build target URL with remaining query params
  const targetParams = new URLSearchParams();
  searchParams.forEach((value, key) => {
    if (key !== 'path') targetParams.set(key, value);
  });
  const qs = targetParams.toString();
  const targetUrl = `${TREAD_BASE}${path}${qs ? `?${qs}` : ''}`;

  const headers: Record<string, string> = {
    'Authorization': `Token ${token}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': WAF_USER_AGENT,
  };

  const fetchOptions: RequestInit = { method, headers };
  if (method === 'POST' || method === 'DELETE') {
    try {
      const body = await req.text();
      if (body) fetchOptions.body = body;
    } catch {
      // no body
    }
  }

  try {
    const response = await fetch(targetUrl, fetchOptions);
    const data = await response.text();

    return new NextResponse(data, {
      status: response.status,
      headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/json' },
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Proxy error: ${error instanceof Error ? error.message : 'Unknown'}` },
      { status: 502 },
    );
  }
}
