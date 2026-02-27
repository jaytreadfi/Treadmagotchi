/**
 * Tread API client — ported from treadbot/backend/app/clients/treadfi.py.
 * All requests go through /api/proxy/tread to handle CORS + WAF.
 */
import { PROXY_BASE, pairToTreadfi, treadfiToPair } from '@/lib/constants';
import type { Position, AccountInfo, TreadAccount } from '@/lib/types';

function getToken(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('treadfi_api_key') || '';
}

/** Resolve exchange name to TreadTools endpoint name */
function exchangeToTreadtools(exchange: string): string {
  const ex = exchange.toLowerCase();
  if (ex.includes('paradex')) return 'paradex';
  if (ex.includes('hyperliquid')) return 'hyperliquid';
  if (ex.includes('bybit')) return 'bybit';
  if (ex.includes('extended')) return 'hyperliquid'; // Extended = Hyperliquid extended
  return ex;
}

async function request(method: string, path: string, params?: Record<string, string>, body?: unknown): Promise<unknown> {
  const token = getToken();
  if (!token) throw new Error('No Tread API key configured');

  const searchParams = new URLSearchParams({ path, ...params });
  const url = `${PROXY_BASE}/tread?${searchParams.toString()}`;

  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-tread-token': token,
    },
  };
  if (body && (method === 'POST' || method === 'DELETE')) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Tread API ${response.status}: ${text.slice(0, 300)}`);
  }

  const text = await response.text();
  if (!text) return {};
  return JSON.parse(text);
}

// ── Account & Balance ──

export async function getCachedBalances(accountName?: string): Promise<Record<string, unknown>> {
  const name = accountName || 'Paradex';
  return request('GET', '/api/sor/get_cached_account_balance', {
    account_names: name,
  }) as Promise<Record<string, unknown>>;
}

export async function getAccountInfo(accountName?: string): Promise<AccountInfo> {
  accountName = accountName || 'Paradex';
  try {
    const data = await getCachedBalances(accountName) as { balances?: Array<Record<string, unknown>> };
    const balances = data.balances || [];

    for (const bal of balances) {
      const nameMatch = String(bal.account_name || '').toLowerCase() === accountName.toLowerCase();
      if (!nameMatch) continue;

      let equity = Number(bal.equity || 0);
      if (equity <= 0) {
        for (const eq of (bal.equities as Array<Record<string, unknown>> || [])) {
          const total = Number(eq.total_equity || 0);
          if (total > 0) { equity = total; break; }
        }
      }
      if (equity <= 0) continue;

      let unrealized_pnl = 0;
      let margin_used = 0;
      for (const asset of (bal.assets as Array<Record<string, unknown>> || [])) {
        if (asset.asset_type === 'position') {
          if (asset.unrealized_profit != null) unrealized_pnl += Number(asset.unrealized_profit);
          margin_used += Math.abs(Number(asset.notional || 0));
        }
      }

      return {
        balance: equity - unrealized_pnl,
        equity,
        unrealized_pnl,
        margin_used,
      };
    }
  } catch {
    // fallback below
  }

  const capital = Number(localStorage.getItem('initial_capital') || 100);
  return { balance: capital, equity: capital, unrealized_pnl: 0, margin_used: 0 };
}

export async function getPositions(accountName?: string): Promise<Position[]> {
  accountName = accountName || 'Paradex';
  try {
    const data = await getCachedBalances(accountName) as { balances?: Array<Record<string, unknown>> };
    const balances = data.balances || [];

    for (const bal of balances) {
      if (String(bal.account_name || '').toLowerCase() !== accountName!.toLowerCase()) continue;

      const positions: Position[] = [];
      for (const asset of (bal.assets as Array<Record<string, unknown>> || [])) {
        if (asset.asset_type !== 'position') continue;

        const size = Number(asset.amount || asset.size || 0);
        if (size === 0) continue;

        const symbol = String(asset.symbol || '');
        const pair = symbol.includes(':') ? treadfiToPair(symbol) : `${symbol}-USD`;
        const notional = Number(asset.notional || 0);
        const unrealized_pnl = Number(asset.unrealized_profit || 0);
        const leverage = Number(asset.leverage || 1);
        const absSize = Math.abs(size);

        let mark_price = 0;
        let entry_price = 0;
        if (absSize > 0 && notional !== 0) {
          mark_price = Math.abs(notional) / absSize;
          entry_price = size > 0
            ? mark_price - (unrealized_pnl / absSize)
            : mark_price + (unrealized_pnl / absSize);
        }

        positions.push({
          pair,
          side: size > 0 ? 'buy' : 'sell',
          size: absSize,
          entry_price: Math.max(entry_price, 0),
          mark_price: Math.max(mark_price, 0),
          unrealized_pnl,
          leverage,
        });
      }
      return positions;
    }
  } catch {
    // fallback
  }
  return [];
}

// ── MM Bot Orders ──

export async function submitMmOrder(params: {
  pair: string;
  margin: number;
  duration: number;
  leverage: number;
  engine_passiveness: number;
  schedule_discretion: number;
  alpha_tilt: number;
  notes: string;
  account_name: string;
}): Promise<Record<string, unknown>> {
  const accountName = params.account_name;
  const treadfiPair = pairToTreadfi(params.pair);

  // Only send margin + leverage. Tread calculates base_asset_qty from these.
  const payload: Record<string, unknown> = {
    accounts: [accountName],
    duration: Math.min(params.duration, 86400),
    strategy: 'TWAP',
    strategy_params: {
      passive_only: true,
      active_limit: true,
      soft_pause: true,
      cleanup_on_cancel: true,
    },
    engine_passiveness: params.engine_passiveness,
    schedule_discretion: params.schedule_discretion,
    margin: params.margin,
    leverage: params.leverage,
    market_maker: true,
    notes: params.notes,
    child_orders: [
      { accounts: [accountName], pair: treadfiPair, side: 'buy' },
      { accounts: [accountName], pair: treadfiPair, side: 'sell' },
    ],
  };

  if (params.alpha_tilt !== 0) {
    payload.alpha_tilt = Math.round(params.alpha_tilt * 100) / 100;
  }

  return request('POST', '/api/multi_orders/', undefined, payload) as Promise<Record<string, unknown>>;
}

export async function changeMmSpread(params: {
  multi_order_id: string;
  spread_bps: number;
  reference_price: string;
  grid_stop_loss_percent?: number | null;
  grid_take_profit_percent?: number | null;
}): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = {
    multi_order_id: params.multi_order_id,
    spread_bps: params.spread_bps,
    reference_price: params.reference_price,
  };
  if (params.grid_stop_loss_percent != null) payload.grid_stop_loss_percent = params.grid_stop_loss_percent;
  if (params.grid_take_profit_percent != null) payload.grid_take_profit_percent = params.grid_take_profit_percent;

  return request('POST', '/api/change_mm_spread/', undefined, payload) as Promise<Record<string, unknown>>;
}

export async function getMmOrders(statuses?: string, limit = 20): Promise<Record<string, unknown>> {
  const params: Record<string, string> = { page_size: String(limit) };
  if (statuses) params.statuses = statuses;
  return request('GET', '/api/market_maker_orders/', params) as Promise<Record<string, unknown>>;
}

export async function getActiveMmBots(): Promise<Array<Record<string, unknown>>> {
  try {
    const data = await getMmOrders('ACTIVE', 50) as Record<string, unknown>;
    const orders = (data.market_maker_orders || data.multi_orders || data.results || data.orders || []) as Array<Record<string, unknown>>;
    return Array.isArray(orders) ? orders : [];
  } catch {
    return [];
  }
}

/** Get total executed_notional across all active MM bots (live filled volume). */
export async function getActiveBotsVolume(): Promise<{ totalVolume: number; perBot: Array<{ id: string; volume: number }> }> {
  try {
    const bots = await getActiveMmBots();
    let totalVolume = 0;
    const perBot: Array<{ id: string; volume: number }> = [];
    for (const bot of bots) {
      const vol = Number(bot.executed_notional || 0);
      totalVolume += vol;
      perBot.push({ id: String(bot.id || ''), volume: vol });
    }
    return { totalVolume, perBot };
  } catch {
    return { totalVolume: 0, perBot: [] };
  }
}

export async function cancelMultiOrder(multiOrderId: string): Promise<unknown> {
  return request('POST', '/api/cancel_multi_orders/', undefined, { order_ids: [multiOrderId] });
}

export async function pauseMultiOrder(multiOrderId: string): Promise<unknown> {
  return request('POST', '/api/pause_multi_order/', undefined, { multi_order_id: multiOrderId });
}

export async function resumeMultiOrder(multiOrderId: string): Promise<unknown> {
  return request('POST', '/api/resume_multi_order/', undefined, { multi_order_id: multiOrderId });
}

export async function getMultiOrder(multiOrderId: string): Promise<Record<string, unknown>> {
  return request('GET', `/api/multi_order/${multiOrderId}`, { include_child_orders: 'true' }) as Promise<Record<string, unknown>>;
}

export async function getMultiOrderTca(multiOrderId: string): Promise<Record<string, unknown>> {
  return request('GET', '/api/multi_order_tca', { multi_order_id: multiOrderId }) as Promise<Record<string, unknown>>;
}

// ── Order Book / Price ──

export async function getOrderBook(pair: string, exchange = 'Paradex'): Promise<Record<string, unknown>> {
  const treadfiPair = pairToTreadfi(pair);
  return request('GET', '/api/get_order_book', { pair: treadfiPair, exchange_name: exchange }) as Promise<Record<string, unknown>>;
}

export async function getMidPrice(pair: string, exchange = 'Paradex'): Promise<number | null> {
  try {
    const book = await getOrderBook(pair, exchange);
    const bids = book.bids as Array<Record<string, unknown>> | Array<[number, number]> | undefined;
    const asks = book.asks as Array<Record<string, unknown>> | Array<[number, number]> | undefined;
    if (bids?.length && asks?.length) {
      const bestBid = typeof bids[0] === 'object' && !Array.isArray(bids[0])
        ? Number((bids[0] as Record<string, unknown>).price)
        : Number((bids[0] as [number, number])[0]);
      const bestAsk = typeof asks[0] === 'object' && !Array.isArray(asks[0])
        ? Number((asks[0] as Record<string, unknown>).price)
        : Number((asks[0] as [number, number])[0]);
      return (bestBid + bestAsk) / 2;
    }
  } catch {
    // fallback
  }
  return null;
}

// ── Accounts ──

export async function getAccounts(): Promise<TreadAccount[]> {
  try {
    const data = await request('GET', '/api/accounts/') as Record<string, unknown> | Array<Record<string, unknown>>;
    const raw = Array.isArray(data) ? data : (data.accounts as Array<Record<string, unknown>>) || [];
    return raw
      .filter((a) => a.valid && !a.archived)
      .map((a) => ({
        name: String(a.name || ''),
        id: String(a.id || ''),
        exchange: String(a.exchange || ''),
        enabled: true, // enabled by default, user can toggle off
      }));
  } catch {
    return [];
  }
}

export { exchangeToTreadtools };

// ── Validate token ──

export async function validateToken(): Promise<boolean> {
  try {
    await getCachedBalances();
    return true;
  } catch {
    return false;
  }
}
