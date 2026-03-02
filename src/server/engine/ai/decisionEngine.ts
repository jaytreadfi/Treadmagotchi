/**
 * Server-side decision engine -- one Claude call returns multiple trades.
 * Falls back to rule-based if no API key or Claude fails.
 */
import { getDecisions } from '@/server/clients/claudeApi';
import { getRuleBasedDecision } from './ruleBasedFallback';
import { buildSystemPrompt, buildDecisionPrompt } from './promptBuilder';
import { sseEmitter } from '@/server/engine/sseEmitter';
import * as repository from '@/server/db/repository';
import * as configStore from '@/server/db/configStore';
import type { AIDecision, Position, RiskMetrics, TreadtoolsSnapshot } from '@/lib/types';

export async function makeDecisions(params: {
  positions: Position[];
  accountsContext: string;
  treadtoolsContext: string;
  tradingviewContext: string;
  recentPerformance: string;
  tradeHistory: string;
  patternAnalysis: string;
  regimeContext?: string;
  orderbookContext?: string;
  lessonsContext?: string;
  snapshot: TreadtoolsSnapshot | null;
  metrics: RiskMetrics;
  totalEquity: number;
}): Promise<AIDecision[]> {
  const system = buildSystemPrompt();
  const user = buildDecisionPrompt({
    positions: params.positions,
    accounts_context: params.accountsContext,
    treadtools_context: params.treadtoolsContext,
    tradingview_context: params.tradingviewContext,
    recent_performance: params.recentPerformance,
    trade_history: params.tradeHistory,
    pattern_analysis: params.patternAnalysis,
    regime_context: params.regimeContext,
    orderbook_context: params.orderbookContext,
    lessons_context: params.lessonsContext,
  });

  const result = await getDecisions(system, user);

  if (result.ok) {
    if (result.decisions.length > 0) return result.decisions;
    return [];
  }

  // Claude failed — determine how to handle
  if (result.code !== 'no_key') {
    console.error(`[DecisionEngine] Claude API failed (${result.code}): ${result.error}`);
    sseEmitter.emit('error', {
      message: `AI decision engine failed (${result.code}). Using rule-based fallback.`,
    });
    repository.saveActivity({
      timestamp: Date.now(),
      category: 'engine',
      action: 'ai_fallback',
      pair: null,
      detail: JSON.stringify({ code: result.code, error: result.error }),
    });
  }

  // Fallback: single rule-based decision
  const accounts = configStore.getConfig<Array<{ name: string; enabled: boolean }>>('accounts') || [];
  const firstEnabled = accounts.find((a) => a.enabled)?.name;
  const fallback = getRuleBasedDecision(params.snapshot, params.metrics, params.totalEquity, firstEnabled);
  return fallback.action === 'market_make' ? [fallback] : [];
}
