/**
 * Server-side Hyperliquid Info API client — direct HTTP, no proxy.
 */

const HL_BASE = 'https://api.hyperliquid.xyz/info';

async function hlRequest(payload: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(HL_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
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
