/**
 * Server-side Claude API client — direct HTTP to Anthropic API, no proxy.
 */
import { CLAUDE_MODEL } from '@/lib/constants';
import { getConfig } from '@/server/db/configStore';
import type { AIDecision } from '@/lib/types';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

export type ClaudeResult =
  | { ok: true; decisions: AIDecision[] }
  | { ok: false; error: string; code: 'no_key' | 'http_error' | 'parse_error' | 'truncated' | 'exception' };

function safeNumber(val: unknown, min: number, max: number): number | undefined {
  const n = Number(val);
  if (!Number.isFinite(n) || n < min || n > max) return undefined;
  return n;
}

export async function getDecisions(
  systemPrompt: string,
  userPrompt: string,
): Promise<ClaudeResult> {
  const apiKey = getConfig<string>('anthropic_api_key');
  if (!apiKey) {
    return { ok: false, error: 'No Anthropic API key configured', code: 'no_key' };
  }

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('[ClaudeAPI] Error:', res.status, text.slice(0, 200));
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 100)}`, code: 'http_error' };
    }

    const data = await res.json();

    if (data.stop_reason === 'max_tokens') {
      console.error('[ClaudeAPI] Response truncated (max_tokens) -- rejecting to avoid partial trades');
      return { ok: false, error: 'Response truncated at max_tokens', code: 'truncated' };
    }

    const raw = data.content?.[0]?.text?.trim();
    if (!raw) return { ok: true, decisions: [] };

    const parsed = parseJsonArray(raw);
    if (!parsed) {
      console.error('[ClaudeAPI] Failed to parse response as array:', raw.slice(0, 300));
      return { ok: false, error: 'Failed to parse AI response as JSON', code: 'parse_error' };
    }

    const decisions = parsed.map((item): AIDecision => {
      const isMarketMake = item.action === 'market_make';
      const margin = safeNumber(item.margin, 0, 100000);
      const leverage = safeNumber(item.leverage, 1, 50);

      if (isMarketMake && (margin == null || leverage == null)) {
        return { action: 'hold', reasoning: String(item.reasoning || 'Invalid params — margin or leverage out of range') };
      }

      return {
        action: isMarketMake ? 'market_make' : 'hold',
        account: typeof item.account === 'string' ? item.account : undefined,
        pair: typeof item.pair === 'string' ? item.pair : undefined,
        margin,
        leverage,
        duration: safeNumber(item.duration, 60, 14400),
        spread_bps: safeNumber(item.spread_bps, -10, 50),
        reference_price: typeof item.reference_price === 'string' ? item.reference_price : undefined,
        engine_passiveness: safeNumber(item.engine_passiveness, 0, 1),
        schedule_discretion: safeNumber(item.schedule_discretion, 0, 1),
        alpha_tilt: safeNumber(item.alpha_tilt, -1, 1),
        grid_take_profit_pct: safeNumber(item.grid_take_profit_pct, 0, 100),
        confidence: safeNumber(item.confidence, 0, 1),
        reasoning: String(item.reasoning || ''),
      };
    });

    return { ok: true, decisions };
  } catch (err) {
    console.error('[ClaudeAPI] Exception:', err);
    return { ok: false, error: err instanceof Error ? err.message : String(err), code: 'exception' };
  }
}

function parseJsonArray(text: string): Array<Record<string, unknown>> | null {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (typeof parsed === 'object' && parsed !== null) return [parsed];
  } catch { /* continue */ }

  const fenceMatch = text.match(/```(?:json)?\s*\n?(.*?)\n?```/s);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (Array.isArray(parsed)) return parsed;
      if (typeof parsed === 'object' && parsed !== null) return [parsed];
    } catch { /* continue */ }
  }

  const arrStart = text.indexOf('[');
  const arrEnd = text.lastIndexOf(']');
  if (arrStart !== -1 && arrEnd > arrStart) {
    try {
      const parsed = JSON.parse(text.slice(arrStart, arrEnd + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch { /* continue */ }
  }

  const objStart = text.indexOf('{');
  const objEnd = text.lastIndexOf('}');
  if (objStart !== -1 && objEnd > objStart) {
    try {
      const parsed = JSON.parse(text.slice(objStart, objEnd + 1));
      if (typeof parsed === 'object') return [parsed];
    } catch { /* continue */ }
  }

  console.error('[ClaudeAPI] All JSON parse strategies failed. Raw text:', text.slice(0, 500));
  return null;
}
