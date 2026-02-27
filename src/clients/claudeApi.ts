/**
 * Claude API client — single call returns array of trade decisions.
 */
import { PROXY_BASE, CLAUDE_MODEL } from '@/lib/constants';
import type { AIDecision } from '@/lib/types';

function getAnthropicKey(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('anthropic_api_key') || '';
}

/** Returns an array of decisions (empty = hold all). */
export async function getDecisions(
  systemPrompt: string,
  userPrompt: string,
): Promise<AIDecision[]> {
  const apiKey = getAnthropicKey();
  if (!apiKey) {
    return []; // no key = fallback handled by caller
  }

  try {
    const res = await fetch(`${PROXY_BASE}/claude`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-anthropic-key': apiKey,
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('[ClaudeAPI] Error:', res.status, text.slice(0, 200));
      return [];
    }

    const data = await res.json();
    const raw = data.content?.[0]?.text?.trim();
    if (!raw) return [];

    const parsed = parseJsonArray(raw);
    if (!parsed) {
      console.error('[ClaudeAPI] Failed to parse response as array:', raw.slice(0, 300));
      return [];
    }

    return parsed.map((item): AIDecision => ({
      action: item.action === 'market_make' ? 'market_make' : 'hold',
      account: item.account as string | undefined,
      pair: item.pair as string | undefined,
      margin: item.margin as number | undefined,
      leverage: item.leverage as number | undefined,
      duration: item.duration as number | undefined,
      spread_bps: item.spread_bps as number | undefined,
      reference_price: item.reference_price as string | undefined,
      engine_passiveness: item.engine_passiveness as number | undefined,
      schedule_discretion: item.schedule_discretion as number | undefined,
      alpha_tilt: item.alpha_tilt as number | undefined,
      grid_take_profit_pct: item.grid_take_profit_pct as number | undefined,
      confidence: item.confidence as string | undefined,
      reasoning: String(item.reasoning || ''),
    }));
  } catch (err) {
    console.error('[ClaudeAPI] Exception:', err);
    return [];
  }
}

function parseJsonArray(text: string): Array<Record<string, unknown>> | null {
  // Direct parse
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    // Single object → wrap in array
    if (typeof parsed === 'object' && parsed !== null) return [parsed];
  } catch { /* continue */ }

  // Markdown code block
  const fenceMatch = text.match(/```(?:json)?\s*\n?(.*?)\n?```/s);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (Array.isArray(parsed)) return parsed;
      if (typeof parsed === 'object' && parsed !== null) return [parsed];
    } catch { /* continue */ }
  }

  // First [ to last ]
  const arrStart = text.indexOf('[');
  const arrEnd = text.lastIndexOf(']');
  if (arrStart !== -1 && arrEnd > arrStart) {
    try {
      const parsed = JSON.parse(text.slice(arrStart, arrEnd + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch { /* continue */ }
  }

  // First { to last } (single object fallback)
  const objStart = text.indexOf('{');
  const objEnd = text.lastIndexOf('}');
  if (objStart !== -1 && objEnd > objStart) {
    try {
      const parsed = JSON.parse(text.slice(objStart, objEnd + 1));
      if (typeof parsed === 'object') return [parsed];
    } catch { /* continue */ }
  }

  return null;
}
