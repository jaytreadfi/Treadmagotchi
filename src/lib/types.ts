// ── Core trading types (ported from Treadbot Python models) ──

export type OrderSide = 'buy' | 'sell';

export interface Position {
  pair: string;
  side: OrderSide;
  size: number;
  entry_price: number;
  mark_price: number;
  unrealized_pnl: number;
  leverage: number;
}

export interface AccountInfo {
  balance: number;
  equity: number;
  unrealized_pnl: number;
  margin_used: number;
}

export interface MarketSuitability {
  symbol: string;
  score: number;
  stability_mins: number;
  status: string;
  oi_bbo: number;
  volume: number;
}

export interface PairRanking {
  rank: number;
  exchange: string;
  symbol: string;
  strategy: string;
  gross_pnl: number;
  volume: number;
  count: number;
}

export interface TreadtoolsSnapshot {
  timestamp: string;
  hyperliquid_markets: MarketSuitability[];
  paradex_markets: MarketSuitability[];
  all_markets: MarketSuitability[]; // merged, deduplicated (best score wins)
  rankings: Record<string, PairRanking[]>;
  calm_pairs: string[];
}

export interface RiskMetrics {
  total_exposure: number;
  exposure_pct: number;
  largest_position: number;
  largest_position_pct: number;
  num_positions: number;
  unrealized_pnl: number;
  realized_pnl: number;
  drawdown: number;
  drawdown_pct: number;
  sharpe_ratio: number;
  can_trade: boolean;
  risk_message: string;
  daily_loss: number;
}

export interface AIDecision {
  action: 'market_make' | 'hold';
  account?: string;  // which account to execute on
  pair?: string;
  margin?: number;
  leverage?: number;
  duration?: number;
  spread_bps?: number;
  reference_price?: string;
  engine_passiveness?: number;
  schedule_discretion?: number;
  alpha_tilt?: number;
  grid_take_profit_pct?: number;
  confidence?: number | string;
  reasoning: string;
}

// ── Pet types ──

export type EvolutionStage =
  | 'EGG'
  | 'CRITTER'
  | 'CREATURE'
  | 'BEAST'
  | 'MYTHIC';

export type PetMood =
  | 'dead'
  | 'starving'
  | 'sick'
  | 'hungry'
  | 'proud'
  | 'excited'
  | 'angry'
  | 'sad'
  | 'determined'
  | 'sleeping'
  | 'bored'
  | 'happy'
  | 'content';

export type PetMode = 'auto' | 'manual';

export interface PetVitals {
  hunger: number;     // 0-100
  happiness: number;  // 0-100
  energy: number;     // 0-100
  health: number;     // 0-100
}

export interface PetState {
  name: string;
  mode: PetMode;
  vitals: PetVitals;
  mood: PetMood;
  stage: EvolutionStage;
  cumulative_volume: number;
  consecutive_losses: number;
  last_trade_time: number | null;
  last_save_time: number;
  is_alive: boolean;
  just_evolved: boolean;
  speech_bubble: string | null;
  speech_bubble_until: number | null;
}

// ── Trading state ──

export interface TradeRecord {
  id?: number;
  treadfi_id: string | null;
  pair: string;
  side: string;
  quantity: number;
  price: number | null;
  status: string;
  reasoning: string;
  mm_params: string;
  account_name: string | null;
  source: string;
  timestamp: number;
  realized_pnl: number | null;
}

export interface TradeOutcome {
  id?: number;
  trade_id: number;
  realized_pnl: number;
  outcome: 'win' | 'loss' | 'breakeven';
  timestamp: number;
}

// ── Config ──

export interface TreadAccount {
  name: string;        // Display name from Tread API (e.g. "Paradex", "Bybit Main")
  id: string;          // Account ID from Tread
  exchange: string;    // Exchange name (paradex, bybit, hyperliquid)
  enabled: boolean;    // Whether the bot can trade on this account
}

// ── Decision log ──

export interface DecisionLogEntry {
  timestamp: string;
  action: string;
  pair: string | null;
  reasoning: string;
  active_pairs: string[];
  calm_pairs: string[];
  portfolio: {
    balance: number;
    equity: number;
    unrealized_pnl: number;
    exposure_pct: number;
  };
}
