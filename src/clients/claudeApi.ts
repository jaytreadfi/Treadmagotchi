/**
 * Claude API client — ported from treadbot/backend/app/ai/engine.py.
 * Calls Anthropic Messages API through /api/proxy/claude.
 */
import { PROXY_BASE, CLAUDE_MODEL } from '@/lib/constants';
import type { AIDecision } from '@/lib/types';

function getAnthropicKey(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('anthropic_api_key') || '';
}

export async function getDecision(
  systemPrompt: string,
  userPrompt: string,
): Promise<AIDecision> {
  const apiKey = getAnthropicKey();
  if (!apiKey) {
    return { action: 'hold', reasoning: 'No Anthropic API key configured. Using rule-based fallback.' };
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
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      if (text.toLowerCase().includes('credit balance') || text.toLowerCase().includes('billing')) {
        return { action: 'hold', reasoning: 'Anthropic API credits exhausted.' };
      }
      return { action: 'hold', reasoning: `AI unavailable: HTTP ${res.status}` };
    }

    const data = await res.json();
    const raw = data.content?.[0]?.text?.trim();
    if (!raw) {
      return { action: 'hold', reasoning: 'Empty AI response' };
    }

    const parsed = parseJson(raw);
    if (!parsed) {
      return { action: 'hold', reasoning: 'Failed to parse AI response' };
    }

    return {
      action: parsed.action === 'market_make' ? 'market_make' : 'hold',
      account: parsed.account as string | undefined,
      pair: parsed.pair as string | undefined,
      margin: parsed.margin as number | undefined,
      leverage: parsed.leverage as number | undefined,
      duration: parsed.duration as number | undefined,
      spread_bps: parsed.spread_bps as number | undefined,
      reference_price: parsed.reference_price as string | undefined,
      engine_passiveness: parsed.engine_passiveness as number | undefined,
      schedule_discretion: parsed.schedule_discretion as number | undefined,
      alpha_tilt: parsed.alpha_tilt as number | undefined,
      grid_take_profit_pct: parsed.grid_take_profit_pct as number | undefined,
      confidence: parsed.confidence as string | undefined,
      reasoning: String(parsed.reasoning || ''),
    };
  } catch (err) {
    return { action: 'hold', reasoning: `AI error: ${err instanceof Error ? err.message : 'Unknown'}` };
  }
}

function parseJson(text: string): Record<string, unknown> | null {
  // Direct parse
  try { return JSON.parse(text); } catch { /* continue */ }

  // Markdown code block
  const fenceMatch = text.match(/```(?:json)?\s*\n?(.*?)\n?```/s);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch { /* continue */ }
  }

  // First { to last }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch { /* continue */ }
  }

  return null;
}
