/**
 * Hyperliquid Info API client — ported from treadbot/backend/app/clients/hyperliquid.py.
 * All requests go through /api/proxy/hyperliquid.
 */
import { PROXY_BASE } from '@/lib/constants';

async function hlRequest(payload: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${PROXY_BASE}/hyperliquid`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Hyperliquid API ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

export async function getAllMids(): Promise<Record<string, number>> {
  const data = await hlRequest({ type: 'allMids' }) as Record<string, string>;
  const mids: Record<string, number> = {};
  for (const [coin, price] of Object.entries(data)) {
    mids[coin] = parseFloat(price);
  }
  return mids;
}
