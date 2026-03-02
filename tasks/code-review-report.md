# Server Migration Code Review — 7-Agent Consolidated Report

**Date**: 2026-03-02
**Branch**: `server-migration`
**Scope**: 46 files changed (+2,409 / -3,705 lines)
**Agents**: Engine Core, API Routes, DB Layer, API Clients, Frontend, Security, Dead Code

---

## P0 — CRITICAL (Fix before deploying with real money)

### 1. API keys stored in PLAINTEXT in SQLite
**Agent**: Security
**File**: `src/server/db/configStore.ts:165`
`setConfig('treadfi_api_key', value)` calls `JSON.stringify(value)` and writes it raw. Anyone with read access to the `.db` file gets your Tread.fi API key.
**Fix**: Encrypt with AES-256-GCM using a master key stored in a separate `data/.master-key` file with 0600 permissions.

### 2. Circuit breaker bypass during engine startup
**Agent**: Engine Core
**File**: `src/server/engine/index.ts:79-82`
If the DB circuit breaker trips during `start()`, it calls `this.stop()`, but `start()` continues execution after `stop()` returns. It sets `this.running = true` and starts the scheduler. The engine runs despite the circuit breaker having tripped.
**Fix**: Check `dbCircuitBreaker.tripped` after each startup step, or set a `this.aborted` flag in `stop()` that `start()` checks.

### 3. Auth bypassed entirely without REVERSE_PROXY=true
**Agent**: Security
**File**: `src/server/middleware/auth.ts:171-173`
When `REVERSE_PROXY !== 'true'`, `authenticate()` returns `{ authenticated: true }` unconditionally. Every route is unauthenticated on localhost. Any process on the same machine can submit trades.
**Fix**: Always require auth on mutating endpoints (POST/DELETE) regardless of REVERSE_PROXY.

### 4. `getAccountInfo` removed fallback — returns zeros on API failure
**Agent**: API Clients
**File**: `src/server/clients/treadApi.ts:109-113`
Old code fell back to `initial_capital` from localStorage. New code returns `{ balance: 0, equity: 0 }`. The engine thinks the account is empty and may refuse to trade or produce division-by-zero.
**Fix**: Read `initial_capital` from configStore as fallback. Restore graceful degradation.

### 5. `getAccountInfo` error handling changed from graceful to crash
**Agent**: API Clients
**File**: `src/server/clients/treadApi.ts:109-111`
`catch (err) { throw err; }` — this is a no-op pattern that replaced silent degradation. Transient API errors now crash the entire decision loop.
**Fix**: Remove the pointless try/catch or restore fallback behavior.

### 6. Duplicated `getTokenPath()` in token rotation route
**Agent**: API Routes
**File**: `src/app/api/auth/rotate/route.ts:22-31`
Copy-pasted from `auth.ts`. If either is modified independently, rotation writes to a different file than auth reads.
**Fix**: Export `getTokenPath()` from `auth.ts` and import it.

### 7. Non-atomic onboarding config writes
**Agent**: API Routes
**File**: `src/app/api/config/onboard/route.ts:69-75`
If `treadfi_api_key` succeeds but `accounts` fails validation, keys are persisted but endpoint returns 400. No rollback.
**Fix**: Wrap all config writes in `runInTransaction()`, or validate all entries before writing any.

---

## P1 — HIGH (Fix before production)

### 8. `claudeApi` return type changed — callers may be broken
**Agent**: API Clients
**File**: `src/server/clients/claudeApi.ts:20`
Return type changed from `AIDecision[]` to `ClaudeResult` (discriminated union `{ ok, decisions } | { ok: false, error }`). If any caller wasn't updated, the bot silently stops trading.
**Verify**: All callers of `getDecisions` handle the new `result.ok` check.

### 9. NaN PnL emitted to SSE clients
**Agent**: Engine Core
**File**: `src/server/engine/executor.ts:322-328`
`trade_completed` SSE event sends raw `pnl` which is `NaN` when `pnlUncertain` is true. Propagates NaN through client.
**Fix**: `pnl: pnlUncertain ? null : pnl`

### 10. `getAllConfig()` exposes raw API keys to server-side callers
**Agent**: Security
**File**: `src/server/db/configStore.ts:204-217`
Returns all values including plaintext secrets. If any future code logs or reports this, keys leak.
**Fix**: Rename to `getAllConfigUnsafe()` and create `getAllConfigRedacted()` as default.

### 11. `last_drawdown_pct` never written — adaptive interval is dead
**Agent**: Engine Core
**File**: `src/server/engine/scheduler.ts:92`
Reads `last_drawdown_pct` from config but nothing ever writes it. Scheduler never speeds up during drawdowns.
**Fix**: Add `configStore.setConfig('last_drawdown_pct', metrics.drawdown_pct)` in `tradingEngine.ts`.

### 12. `setConfig` not transactional — race condition
**Agent**: DB Layer
**File**: `src/server/db/configStore.ts`
Read + upsert + audit trail write are separate operations, not wrapped in a transaction.
**Fix**: Wrap in `runInTransaction()`.

### 13. Inconsistent auth patterns — 9 routes use manual auth
**Agent**: API Routes
**Files**: engine/start, engine/stop, emergency-stop, pet/feed, pet/interact, pet/revive, migrate, trades, trades/outcomes
All do manual `authenticate()` calls instead of `withAuth` wrapper. If auth logic changes, these routes won't pick it up.
**Fix**: Refactor all routes to use `withAuth`.

### 14. No payload size limits on `/api/migrate`
**Agent**: API Routes + Security
**File**: `src/app/api/migrate/route.ts`
Accepts unbounded arrays. A 500MB JSON body causes memory exhaustion and blocks SQLite.
**Fix**: Add per-array length limits (e.g., 50,000 rows max) and Content-Length check.

### 15. `speech_bubble_until` clock offset not applied
**Agent**: Frontend
**File**: `src/hooks/useSSE.ts:194`
Speech bubble expiry uses raw server timestamp without applying `clockOffset`. Bubble may show too long or too short.
**Fix**: Apply `clockOffset` when computing bubble expiry.

### 16. `pnl_snapshot` SSE event resets `margin_used` to 0
**Agent**: Frontend
**File**: `src/hooks/useSSE.ts:287`
The `pnl_snapshot` event handler overwrites account data with only the snapshot fields, zeroing out `margin_used`.
**Fix**: Merge snapshot data with existing account data instead of overwriting.

### 17. `getPositions` error handling changed to crash
**Agent**: API Clients
**File**: `src/server/clients/treadApi.ts:160-162`
Same `catch (err) { throw err; }` no-op pattern. Old code returned `[]` gracefully.
**Fix**: Remove try/catch or restore `return []` fallback.

---

## P2 — MEDIUM (Fix during cleanup)

### 18. Emergency stop short-circuits if `engine.stop()` throws
**File**: `src/app/api/engine/emergency-stop/route.ts:27`
If `engine.stop()` throws, bot-pausing logic never runs.
**Fix**: Wrap `engine.stop()` in its own try/catch.

### 19. Double `bot_synced` SSE emission per sync cycle
**File**: `src/server/engine/tradingEngine.ts:492-493, 520`
Two events with different shapes — first has `activeBots`, second has `completedCount`. Client gets `undefined` if it reads the wrong field.

### 20. No Content-Security-Policy header
**File**: `next.config.ts`
XSS defense-in-depth missing for a real-money app.

### 21. Health endpoint lacks host validation
**File**: `src/app/api/health/route.ts`
Reachable via DNS rebinding. Leaks uptime info.

### 22. Rate limit consumed before body validation
**File**: `src/app/api/config/keys/route.ts:18-28`
5 malformed requests exhaust rate limit, blocking legitimate updates.

### 23. Optimistic update races with SSE
**Files**: `ModeToggle.tsx:10`, `SettingsPanel.tsx:119`
SSE event can overwrite optimistic UI update before API response arrives.

### 24. Missing `config_history` indexes
**File**: `src/server/db/schema.ts`
No indexes on `changed_at` or `key` columns.

### 25. `showStatus` setTimeout leaks on unmount
**File**: `src/components/screens/SettingsPanel.tsx:28`

### 26. Progress bar unclamped in DecisionCountdown
**File**: `src/components/trading/DecisionCountdown.tsx:65`
Can go negative.

### 27. Duplicate API call — `getActiveMmBots` called twice per sync
**File**: `src/server/engine/tradingEngine.ts:489-502`
Once directly, once inside `getActiveBotsVolume()`.

### 28. Config history table bloat
**File**: `src/server/engine/scheduler.ts:233`
`last_sync_time` written every 30s = ~2,880 audit rows/day.

---

## P3 — DEAD CODE (Remove for clean codebase)

### Dead Constants (`src/lib/constants.ts`)
- `PROXY_BASE` (line 75) — proxy routes deleted
- `CANVAS_DISPLAY_SIZE` (line 82) — never imported
- `DECISION_INTERVAL_MS` (line 25) — server manages own intervals
- `EQUITY_SNAPSHOT_INTERVAL_MS` (line 27) — same
- `MARKET_DATA_INTERVAL_MS` (line 28) — same
- `PET_SAVE_INTERVAL_MS` (line 38) — same

### Dead Types (`src/lib/types.ts`)
- `PetState` (line 116) — server uses `PetStateRow` from schema
- `AppConfig` (line 181) — server uses `configStore`
- `PnLSnapshot` (line 156) — server uses schema type
- `PetEvent` (line 165) — server uses schema type
- `ActivityLogEntry` (line 194) — referenced deleted IndexedDB layer
- `OrderSide` (line 3) — never imported by name

### Dead Store Actions
- `usePetStore`: `setMood`, `setCumulativeVolume`, `setIsAlive`, `reset`
- `useTradingStore`: `setEngineRunning`, `setLastSyncTime`
- `useConfigStore`: `getEnabledAccounts`

### Dead Functions
- `repository.getAllTreadfiIds()` — defined but never called

### Should Un-export (internal-only)
- `evolutionTracker.getStageForVolume`
- `hungerSystem.calculateHungerDecay`
- `hungerSystem.calculateStarvationDamage`

### Should Deduplicate
- `pickData<T>` helper copy-pasted in all 3 store files

---

## POSITIVES (Things done well)

1. **SSE hydration strategy** — buffer-then-reconcile with sequence numbers and server epochs
2. **Write-ahead pattern** — trade persisted before API submission
3. **DB circuit breaker** — halts engine on consecutive DB failures
4. **AbortSignal.timeout on all fetches** — 15s for data, 90s for Claude
5. **Claude response validation** — `safeNumber` clamps AI-generated params to safe ranges
6. **Path/ID validation** on treadApi prevents injection
7. **Timing-safe token comparison** prevents side-channel attacks
8. **Session cookies** — HttpOnly, SameSite=Strict, Secure in production
9. **File permissions** — DB at 0600, data dir at 0700
10. **SSE uses cookies, not query params** — no credential leak in URLs
11. **Per-exchange cache** in treadtoolsApi fixes old cache poisoning bug
12. **Truncation detection** on Claude responses prevents partial trade decisions
13. **Emergency stop** uses `Promise.allSettled` correctly
14. **Migration endpoint** has idempotency guard and proper ID mapping
15. **No orphaned imports** — all deleted modules cleanly rewired
16. **`src/lib/pet/*` architecture** — pure functions shared by server and client, no duplication
