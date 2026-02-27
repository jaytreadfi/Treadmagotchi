/**
 * Decision engine — one Claude call returns multiple trades.
 * Falls back to rule-based if no API key or Claude fails.
 */
import { getDecisions } from '@/clients/claudeApi';
import { getRuleBasedDecision } from './ruleBasedFallback';
import { buildSystemPrompt, buildDecisionPrompt } from './promptBuilder';
import type { AIDecision, Position, RiskMetrics, TreadtoolsSnapshot } from '@/lib/types';

export async function makeDecisions(params: {
  positions: Position[];
  accountsContext: string;
  treadtoolsContext: string;
  tradingviewContext: string;
  recentPerformance: string;
  tradeHistory: string;
  patternAnalysis: string;
  snapshot: TreadtoolsSnapshot | null;
  metrics: RiskMetrics;
  totalEquity: number;
}): Promise<AIDecision[]> {
  // Try Claude first
  try {
    const system = buildSystemPrompt(params.treadtoolsContext);
    const user = buildDecisionPrompt({
      positions: params.positions,
      accounts_context: params.accountsContext,
      treadtools_context: params.treadtoolsContext,
      tradingview_context: params.tradingviewContext,
      recent_performance: params.recentPerformance,
      trade_history: params.tradeHistory,
      pattern_analysis: params.patternAnalysis,
    });

    const decisions = await getDecisions(system, user);

    // If Claude returned trades, use them
    if (decisions.length > 0) return decisions;

    // Empty array from Claude = intentional hold, don't fallback
    // But if no API key was set, getDecisions returns [] and we should fallback
    const hasKey = typeof window !== 'undefined' && localStorage.getItem('anthropic_api_key');
    if (hasKey) return []; // Claude said hold
  } catch {
    // Fall through to rule-based
  }

  // Fallback: single rule-based decision
  const fallback = getRuleBasedDecision(params.snapshot, params.metrics, params.totalEquity);
  return fallback.action === 'market_make' ? [fallback] : [];
}
