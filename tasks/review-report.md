# Migration Plan Review Report — 7-Agent Analysis

**Reviewed**: `tasks/todo.md` (Server-Side Architecture Migration)
**Date**: 2026-03-02
**Agents**: Code Reviewer, Architecture Reviewer, Fullstack Developer, Backend Developer, Frontend Developer, Data Engineer, Penetration Tester

---

## Executive Summary

The migration plan is **exceptionally thorough** — every agent independently rated it as production-grade in its thinking. The crash safety design, security model, SSE hydration strategy, and phased approach are all strong. However, all 7 agents found issues. Below is the deduplicated, priority-ordered list of **38 unique findings** across all agents.

---

## P0 — CRITICAL (Must Fix Before Implementation)

### 1. SSE Auth Token in Query Parameters Leaks Credentials
**Flagged by**: Security, Code Reviewer, Frontend, Fullstack

The bearer token in `/api/events?token=xxx` appears in server logs, browser history, Referer headers, PM2 logs, and reverse proxy logs. For an app managing real money with no token rotation, this is a persistent credential leak.

**Fix**: Use a separate short-lived session token for SSE (issued via `POST /api/auth/session`, TTL 24h). Or implement a custom SSE client using `fetch()` with `Authorization` header instead of `EventSource`.

---

### 2. Auth Token Has No Rotation, Expiry, or Revocation
**Flagged by**: Security, Architecture

The bearer token is generated once on first run and never expires. If leaked (via #1 or any other channel), the attacker has permanent access.

**Fix**: Add `POST /api/auth/rotate`. Implement configurable TTL. Log auth failures. Consider HMAC-signed short-lived session tokens.

---

### 3. `riskManager` and `orderMonitor` Not Protected by `globalThis`
**Flagged by**: Code Reviewer, Architecture, Fullstack, Backend

Both are module-level singletons that will be recreated on HMR in dev mode. `riskManager` resets `peakEquity` to 100 and clears `dailyLosses`. `orderMonitor` loses the tracked orders Map. For a system managing real money, silently resetting risk guards is catastrophic.

**Fix**: Apply the same `globalThis` pattern used for the DB connection and engine singleton. Or make them properties of the engine singleton.

---

### 4. Write-Ahead Pattern Incomplete — `changeMmSpread` Crash Gap
**Flagged by**: Code Reviewer, Architecture, Backend

The executor does `submitMmOrder` → `changeMmSpread` → `saveTrade`. The write-ahead only covers step 1 vs 3. If the process crashes between `submitMmOrder` and `changeMmSpread`, the order runs with default spread settings (potentially dangerous).

**Fix**: Store intended `mm_params` in the write-ahead record. On startup reconciliation, verify spread config matches expectations for recently-submitted trades. Re-apply `changeMmSpread` if mismatched.

---

### 5. Transaction Boundary Wrong for Async Trade Sync Loop
**Flagged by**: Code Reviewer, Backend

The plan shows a single transaction wrapping multiple trade updates, but `syncBotStatuses()` makes async API calls (`treadApi.getMultiOrder()`) between the status update and outcome save. `better-sqlite3` transactions are synchronous — you cannot wrap async I/O in them.

**Fix**: Use per-trade transactions. For each completed trade, after gathering PnL from the API, wrap the three SQLite writes (status + outcome + risk state) in a single synchronous transaction.

---

### 6. No Fetch Timeouts on Upstream API Calls
**Flagged by**: Backend, Architecture

All API clients (`treadApi`, `claudeApi`, `hyperliquidApi`, etc.) use bare `fetch()` with no timeout. A hung upstream blocks the entire trading loop indefinitely. The 5-minute watchdog only allows the *next* loop to start — the stuck loop continues leaking resources.

**Fix**: Add `AbortSignal.timeout(15000)` to all upstream fetches. Use 90s for Claude API calls specifically (they are legitimately slow). The rule-based fallback already exists for Claude failures.

---

### 7. Auth Token Chicken-and-Egg for Onboarding UX
**Flagged by**: Frontend, Fullstack

The auth token is printed to the server console on first run. But the user must authenticate to reach the onboarding flow. There is no specified mechanism for initial authentication.

**Fix options**:
- Auto-open browser with token in URL on first run (like Jupyter Notebook)
- Exempt `/api/config/onboard` from auth during "not yet onboarded" state
- Show a login page where the user pastes the console token
- Set an HttpOnly cookie on the first localhost request automatically

---

### 8. Unsafe SQLite Backup via `cp`
**Flagged by**: Data Engineer, Architecture, Backend

The `npm run backup` script uses `cp`, which can produce a corrupt copy in WAL mode (the WAL and SHM files are not copied atomically with the main DB file).

**Fix**: Use `better-sqlite3`'s `.backup()` API:
```typescript
export function backupDatabase(destPath: string): void {
  db.backup(destPath);
}
```

---

### 9. Missing `unhandledRejection` / `uncaughtException` Handlers
**Flagged by**: Architecture, Backend

`instrumentation.ts` registers SIGTERM/SIGINT but not process error handlers. An unhandled promise rejection from any API client will crash the process without saving pet state or completing in-flight trades.

**Fix**: Add `process.on('unhandledRejection', ...)` that logs the error, saves state, and sets a circuit breaker flag. Do NOT call `process.exit()` — let PM2 handle restarts.

---

### 10. Watchdog Cannot Actually Abort Stuck Trading Loops
**Flagged by**: Backend

The plan's watchdog resets `loopInProgress = false` after 5 minutes but doesn't abort the stuck async function. The old loop continues running in the background, potentially submitting orders concurrently with the new loop.

**Fix**: Use an `AbortController` passed to the trading loop. The watchdog calls `controller.abort()`. The loop checks `signal.aborted` between async steps.

---

### 11. `daily_losses` Should Be Its Own Table, Not a JSON Blob
**Flagged by**: Data Engineer, Backend

Storing `daily_losses` as a JSON map in a single-row `risk_state` table requires full read-modify-write on every update, prevents SQL analytics, and risks lost updates.

**Fix**: Create a `daily_losses` table with `date TEXT PRIMARY KEY, total_loss REAL, updated_at INTEGER`. Atomic `INSERT OR REPLACE` per day. Easy cleanup via `DELETE WHERE date < ?`.

---

## P1 — HIGH (Should Fix Before Implementation)

### 12. Dual `mode` Source of Truth (pet_state vs config)
**Flagged by**: Backend, Fullstack

Both `pet_state.mode` and `config.mode` store the same value. If one is updated without the other, the scheduler and pet state machine disagree.

**Fix**: Make `config` authoritative. Remove `mode` from `pet_state`.

---

### 13. Pet Name Dual Storage (pet_state vs config)
**Flagged by**: Fullstack, Backend

Same issue — `pet_state.name` and `config.pet_name` are two sources of truth.

**Fix**: Store in `config` only. Derive everywhere else.

---

### 14. Migration Ordering — Dexie Removal Before Migration UI
**Flagged by**: Fullstack, Data Engineer

Phase 4.2 (`npm uninstall dexie`) happens before Phase 4.5 (migration UI). But the migration script needs Dexie to read IndexedDB.

**Fix**: Reorder: build migration UI (4.5) BEFORE removing Dexie (4.2). Or move data migration to Phase 1.5 (right after SQLite foundation).

---

### 15. Data Migration Timing — Should Happen Before Engine Switchover
**Flagged by**: Data Engineer

If Phase 3 goes live before migration, the AI prompt builder only sees new SQLite data, losing all historical learning context.

**Fix**: Auto-migrate on first server boot (Phase 1.5), or at minimum, force migration before engine starts.

---

### 16. Speech Bubble Expiry With No Client-Side Tick
**Flagged by**: Frontend, Fullstack

After migration, `tickPetState()` runs on the server but speech bubbles are client-side only. No one clears expired bubbles.

**Fix**: Add a `useEffect` in `PetCanvas.tsx` with `setTimeout` to clear `speech_bubble` when `speech_bubble_until` expires.

---

### 17. Settings Panel Key Pre-Fill Regression
**Flagged by**: Frontend, Fullstack

`GET /api/config` returns `configured: true/false`, never the actual key. But `SettingsPanel.tsx` pre-fills input fields with the key string. After migration, fields show empty strings — users will think keys are gone.

**Fix**: Change store interface from `treadfi_api_key: string` to `treadfi_api_key_configured: boolean`. Redesign settings to show "Key configured" indicators with a "Replace Key" flow.

---

### 18. `handlePet` Interaction Must Be Server-Side
**Flagged by**: Fullstack, Frontend

The "Pet" button does a client-side Zustand update (`happiness + 5`). After migration, the next `pet_updated` SSE event from the server will overwrite it, making the happiness boost invisible.

**Fix**: Make it `POST /api/pet/interact`. Server updates vitals, emits SSE event.

---

### 19. Missing CORS Configuration
**Flagged by**: Security

No CORS headers are specified. Cross-origin POST requests with `text/plain` content type skip preflight and can reach the server.

**Fix**: Do not set `Access-Control-Allow-Origin`. Add explicit OPTIONS handlers returning 403. Ensure Host header validation runs before route logic.

---

### 20. Host Header Validation Insufficient for DNS Rebinding
**Flagged by**: Security

Must handle port stripping (`localhost:3000`), IPv6 variants (`[::1]:3000`, `0:0:0:0:0:0:0:1`), `0.0.0.0`, and `X-Forwarded-Host` bypass.

**Fix**: Parse Host header to extract hostname (strip port). Validate against explicit allowlist. Also validate `Origin` header on mutating requests.

---

### 21. `lastKnownVolume` Map Lost on Restart — False Volume Spike
**Flagged by**: Code Reviewer, Architecture

The in-memory `lastKnownVolume` Map resets on PM2 restart. The next sync reports ALL accumulated bot volume as "new" delta, triggering false evolution events.

**Fix**: Persist `lastKnownVolume` to SQLite, or on startup prime the Map from current API volumes (treating first read as baseline).

---

### 22. `pnlHistory` Not Persisted — Sharpe Ratio Resets on Restart
**Flagged by**: Backend, Architecture, Data Engineer

The `pnlHistory` array (up to 1000 entries for Sharpe ratio) is purely in-memory. After crash/restart, Sharpe is inaccurate.

**Fix**: Derive Sharpe from `pnl_snapshots` table at startup (the data is already there). Or persist `pnlHistory` in `risk_state`.

---

### 23. Graceful Shutdown Doesn't Wait for In-Flight Loop
**Flagged by**: Backend, Code Reviewer

`process.on('SIGTERM', () => { engine.stop(); process.exit(0); })` — `engine.stop()` clears timers but if a trading loop is mid-execution, `process.exit(0)` terminates immediately.

**Fix**: Make `engine.stop()` async. Set `stopping` flag, clear timers, `await` in-flight loop promise, then exit. Poll `loopInProgress` with a deadline matching PM2's `kill_timeout`.

---

### 24. No WAL Checkpoint Strategy
**Flagged by**: Architecture, Backend

WAL files grow until a checkpoint occurs. Long-running read transactions (slow SSE snapshots) can prevent checkpointing.

**Fix**: Add periodic `PRAGMA wal_checkpoint(TRUNCATE)` every hour. Monitor WAL file size in the health endpoint.

---

### 25. `updateTradeStatus()` Missing `treadfi_id` Parameter
**Flagged by**: Backend

The current Dexie version only accepts `(id, status)`, but the write-ahead pattern needs to set `treadfi_id` on confirm. The repository API surface doesn't mention this.

**Fix**: Update `updateTradeStatus(id, status, treadfi_id?)` to accept an optional `treadfi_id`.

---

### 26. Add `UNIQUE(treadfi_id)` Constraint on Trades Table
**Flagged by**: Backend

Without UNIQUE, crash-recovery reconciliation could create duplicate rows for the same Tread.fi order.

**Fix**: Add `UNIQUE(treadfi_id)` (SQLite allows multiple NULLs with UNIQUE).

---

## P2 — MEDIUM (Fix During Implementation)

### 27. Missing Indexes
**Flagged by**: Data Engineer, Backend

Missing: `(pair, timestamp DESC)` on trades, `(type, timestamp DESC)` on pet_events, `(outcome, timestamp DESC)` on trade_outcomes, `(timestamp DESC)` on decision_log.

### 28. `riskManager.seedFromDb()` Is Additive — Double-Counts on Re-Call
**Flagged by**: Code Reviewer

Uses `+= dailyLoss` instead of `= dailyLoss`. Should be idempotent.

### 29. Rate Limiting Implementation Unspecified
**Flagged by**: Backend, Security, Architecture

No algorithm, scope, or implementation approach specified. Use in-memory Map with token-scoped sliding window.

### 30. SSE `seq` Counter Resets on Server Restart
**Flagged by**: Fullstack, Backend

Clients see `seq` go backward, breaking gap detection.

**Fix**: Include `server_epoch` (startup timestamp) in SSE events. On epoch change, discard buffer and re-hydrate.

### 31. `engine_status` SSE Event Firing Frequency Unspecified
**Flagged by**: Frontend, Fullstack

`DecisionCountdown` needs `nextDecisionAt` from `engine_status` events, but the plan doesn't specify when this event fires (after every decision? on start/stop only?).

### 32. Clock Skew Between Server and Client
**Flagged by**: Frontend, Architecture

`nextDecisionAt` is a server timestamp. Client clock offset causes countdown inaccuracy.

**Fix**: Include `serverTime` in `/api/state` response. Client computes `clockOffset`.

### 33. `getAllTreadfiIds()` Full Table Scan
**Flagged by**: Data Engineer, Code Reviewer, Backend

Replace with `SELECT treadfi_id FROM trades WHERE treadfi_id IS NOT NULL`. Consider limiting to recent trades.

### 34. Cache Size 64MB May Be Excessive for Low-Memory VPS
**Flagged by**: Backend

`cache_size = -64000` is aggressive. Consider `-16000` (16MB) for more conservative defaults.

### 35. Emergency Stop Should Be Idempotent
**Flagged by**: Code Reviewer, Backend

Double-clicking should not error. Handle already-paused bots gracefully.

### 36. Implement `.gitignore` Phase 0.1 Immediately
**Flagged by**: Security

The `data/`, `*.db*`, `.master-key`, `.auth-token` entries don't exist yet. If any migration code is written first, sensitive files could be committed.

### 37. Route Handlers Need `force-dynamic` Export
**Flagged by**: Frontend

The plan adds this to the SSE route but not to other API routes. All data routes must have `export const dynamic = 'force-dynamic'` or Next.js may cache/prerender them.

### 38. Missing Components in Migration Checklist
**Flagged by**: Frontend, Fullstack

Not listed in Section 3.10: `PnLDisplay.tsx`, `StatBars.tsx`, `StatusBar.tsx`. Also need new components: `LoadingScreen`, `ErrorScreen`, login/auth page, reconnection banner.

---

## STRENGTHS (Consistently Praised Across All Agents)

1. **Crash safety design** (Section 3.3.1) — write-ahead, atomic transactions, startup reconciliation, circuit breaker
2. **Security threat model** — DNS rebinding awareness, encryption-at-rest with AES-256-GCM + AAD, file permissions
3. **SSE hydration strategy** — buffer-then-reconcile with monotonic `seq` numbers
4. **Phase ordering** — atomic Phase 2+3 deployment, correct dependency sequencing
5. **`globalThis` HMR safety** — correctly applied to DB and engine (needs extension to risk/monitor)
6. **Pure code extraction** (Phase 0.2) — moving pet functions to `src/lib/pet/` before migration
7. **Repository pattern** — mirrors existing API surface for drop-in replacement
8. **Component migration detail** — identifies missing components from earlier drafts, maps each to specific SSE events

---

## Agent Verdicts

| Agent | Rating | Key Quote |
|---|---|---|
| Code Reviewer | Top percentile | "Probably in the top percentile of architecture documents I have reviewed" |
| Architecture | Production-grade | "The migration plan is production-grade in its thoroughness" |
| Fullstack | Exceptionally thorough | "One of the most detailed architecture migration documents I have seen" |
| Backend | Production-grade thinking | "Production-grade in its thinking but needs a pass on implementation details" |
| Frontend | 7/10 frontend readiness | "Architectural decisions are sound. Gaps are in implementation-level detail" |
| Data Engineer | Well-architected | "Well-architected for a single-user trading bot" |
| Security | Strong awareness | "Demonstrates strong security awareness" with 4 critical and 6 high-risk findings |

---

## Recommended Action Order

1. **Now**: Implement Phase 0.1 (`.gitignore` + `.dockerignore`) — zero risk, prevents accidents
2. **Before coding**: Fix P0 items 1-11 in the plan document
3. **During Phase 1**: Fix P1 items 12-13 (dual storage), 25-26 (schema), 27 (indexes)
4. **During Phase 2**: Fix P1 items 7, 17, 19-20 (auth, settings, CORS, Host validation)
5. **During Phase 3**: Fix P1 items 16, 18, 21-24 (frontend state, volume, Sharpe, shutdown, WAL)
6. **Before Phase 4**: Fix P1 items 14-15 (migration ordering)
