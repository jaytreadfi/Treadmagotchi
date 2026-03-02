/**
 * Server-side Tread API client — direct HTTP, no proxy.
 * API key read from SQLite config store.
 */
import { WAF_USER_AGENT, pairToTreadfi, treadfiToPair } from '@/lib/constants';
import { getConfig } from '@/server/db/configStore';
import type { Position, AccountInfo, TreadAccount } from '@/lib/types';

const TREAD_BASE = 'https://app.tread.fi';

function getToken(): string {
  return getConfig<string>('treadfi_api_key') || '';
}

/** Resolve exchange name to TreadTools endpoint name */
function exchangeToTreadtools(exchange: string): string {
  const ex = exchange.toLowerCase();
  if (ex.includes('paradex')) return 'paradex';
  if (ex.includes('hyperliquid')) return 'hyperliquid';
  if (ex.includes('bybit')) return 'bybit';
  if (ex.includes('extended')) return 'hyperliquid';
  return ex;
}

async function request(method: string, path: string, params?: Record<string, string>, body?: unknown): Promise<unknown> {
  const token = getToken();
  if (!token) throw new Error('No Tread API key configured');

  // Validate path components against expected patterns
  if (!/^[\w\-/?.=&%]+$/.test(path)) {
    throw new Error(`Invalid API path: ${path}`);
  }

  const url = new URL(path, TREAD_BASE);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Token ${token}`,
      'User-Agent': WAF_USER_AGENT,
    },
    signal: AbortSignal.timeout(15_000),
  };
  if (body && (method === 'POST' || method === 'DELETE')) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url.toString(), options);
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
      const nameMatch = String(bal.account_name || '').toLowerCase() === accountName!.toLowerCase();
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
  } catch (err) {
    console.error('[treadApi] getAccountInfo failed:', err);
  }

  return { balance: 0, equity: 0, unrealized_pnl: 0, margin_used: 0 };
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
  } catch (err) {
    console.error('[treadApi] getPositions failed:', err);
  }
  return [];
}

// ── MM Bot Orders ──

export async function submitMmOrder(params: {
  pair: string;
  base_qty: number;
  margin: number;
  duration: number;
  leverage: number;
  engine_passiveness: number;
  schedule_discretion: number;
  alpha_tilt: number;
  notes: string;
  account_name: string;
  exchange?: string;
}): Promise<Record<string, unknown>> {
  const accountName = params.account_name;
  const treadfiPair = pairToTreadfi(params.pair, params.exchange);

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
      { accounts: [accountName], pair: treadfiPair, side: 'buy', base_asset_qty: params.base_qty },
      { accounts: [accountName], pair: treadfiPair, side: 'sell', base_asset_qty: params.base_qty },
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
  signal_name?: string;
}): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = {
    multi_order_id: params.multi_order_id,
    spread_bps: params.spread_bps,
    reference_price: params.reference_price,
  };
  if (params.grid_stop_loss_percent != null) payload.grid_stop_loss_percent = params.grid_stop_loss_percent;
  if (params.grid_take_profit_percent != null) payload.grid_take_profit_percent = params.grid_take_profit_percent;
  if (params.signal_name) payload.signal_name = params.signal_name;

  return request('POST', '/api/change_mm_spread/', undefined, payload) as Promise<Record<string, unknown>>;
}

export async function getMmOrders(statuses?: string, limit = 20): Promise<Record<string, unknown>> {
  const params: Record<string, string> = { page_size: String(limit) };
  if (statuses) params.statuses = statuses;
  return request('GET', '/api/market_maker_orders/', params) as Promise<Record<string, unknown>>;
}

export async function getActiveMmBots(): Promise<Array<Record<string, unknown>>> {
  const data = await getMmOrders('ACTIVE', 50) as Record<string, unknown>;
  const orders = (data.market_maker_orders || data.multi_orders || data.results || data.orders || []) as Array<Record<string, unknown>>;
  return Array.isArray(orders) ? orders : [];
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
  // Validate multiOrderId format (UUID-like)
  if (!/^[\w-]+$/.test(multiOrderId)) {
    throw new Error(`Invalid multi order ID: ${multiOrderId}`);
  }
  return request('GET', `/api/multi_order/${multiOrderId}`, { include_child_orders: 'true' }) as Promise<Record<string, unknown>>;
}

export async function getMultiOrderTca(multiOrderId: string): Promise<Record<string, unknown>> {
  if (!/^[\w-]+$/.test(multiOrderId)) {
    throw new Error(`Invalid multi order ID: ${multiOrderId}`);
  }
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
  } catch (err) {
    console.warn(`[treadApi] getMidPrice failed for ${pair}:`, err);
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
        enabled: true,
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
