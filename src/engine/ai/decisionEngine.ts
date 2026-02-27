/**
 * Decision engine — tries Claude first, falls back to rule-based.
 */
import { getDecision } from '@/clients/claudeApi';
import { getRuleBasedDecision } from './ruleBasedFallback';
import { buildSystemPrompt, buildDecisionPrompt } from './promptBuilder';
import type { AIDecision, Position, RiskMetrics, TreadtoolsSnapshot } from '@/lib/types';

export async function makeDecision(params: {
  equity: number;
  unrealizedPnl: number;
  maxMargin: number;
  available: number;
  positions: Position[];
  accountsContext: string;
  treadtoolsContext: string;
  tradingviewContext: string;
  recentPerformance: string;
  tradeHistory: string;
  patternAnalysis: string;
  snapshot: TreadtoolsSnapshot | null;
  metrics: RiskMetrics;
}): Promise<AIDecision> {
  // Try Claude first
  try {
    const system = buildSystemPrompt(params.treadtoolsContext);
    const user = buildDecisionPrompt({
      equity: params.equity,
      unrealized_pnl: params.unrealizedPnl,
      max_margin: params.maxMargin,
      available: params.available,
      positions: params.positions,
      accounts_context: params.accountsContext,
      treadtools_context: params.treadtoolsContext,
      tradingview_context: params.tradingviewContext,
      recent_performance: params.recentPerformance,
      trade_history: params.tradeHistory,
      pattern_analysis: params.patternAnalysis,
    });

    const decision = await getDecision(system, user);

    if (decision.action === 'market_make' || decision.reasoning !== 'No Anthropic API key configured. Using rule-based fallback.') {
      return decision;
    }
  } catch {
    // Fall through to rule-based
  }

  // Fallback
  return getRuleBasedDecision(params.snapshot, params.metrics, params.equity);
}
