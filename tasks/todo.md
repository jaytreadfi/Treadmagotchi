# Code Review Fix — Server Migration

## Status: COMPLETE

All 10 phases implemented. `tsc --noEmit` = 0 errors. `npm run build` = clean.

---

### Phase 1: Auth Hardening & Route Consolidation
- [x] Exported `getTokenPath()` and `getSafeDefaultDataDir()` from `auth.ts`
- [x] Deleted duplicated `getTokenPath()` + `getSafeDefault()` from `auth/rotate/route.ts`
- [x] Removed localhost auth bypass (`REVERSE_PROXY` check) in `authenticate()`
- [x] Converted 9 routes to `withAuth()`: engine/{start,stop,emergency-stop}, pet/{feed,interact,revive}, migrate, trades, trades/outcomes
- [x] Added `validateHost()` to health route
- [x] Wrapped `engine.stop()` in try/catch in emergency-stop so bot-pausing continues

### Phase 2: Engine Lifecycle Safety
- [x] Added `if (this.stopping) { this.starting = false; return; }` after each async step in `start()`
- [x] Wrapped `saveActivity()` in `stop()` with try/catch

### Phase 3: Config Store Fixes
- [x] Wrapped `setConfig` body in `sqlite.transaction()`
- [x] Added `SKIP_AUDIT_KEYS` set (last_sync_time, last_decision_time, last_drawdown_pct)
- [x] Added JSDoc warning on `getAllConfig()` about raw secrets

### Phase 4: API Client Error Handling
- [x] Fixed `getAccountInfo` no-op catch → graceful `console.error` + fallthrough
- [x] Fixed `getPositions` no-op catch → graceful `console.error` + fallthrough

### Phase 5: SSE & Executor Fixes
- [x] Guarded NaN PnL emission: `pnl: pnlUncertain ? null : pnl`
- [x] Removed duplicate `bot_synced` emission, merged into single event
- [x] Eliminated duplicate `getActiveMmBots()` call — compute volume from already-fetched bots
- [x] Removed now-dead `getActiveBotsVolume()` from treadApi.ts
- [x] Fixed `speech_bubble_until` clock offset using `moduleClockOffset`
- [x] Fixed `pnl_snapshot` preserving current `margin_used` instead of zeroing

### Phase 6: Onboarding & Migration Safety
- [x] Wrapped onboard config writes in `sqlite.transaction()`
- [x] Added payload size limits to migrate route (10K/10K/50K/10K/50K)

### Phase 7: Scheduler Fixes
- [x] Write `last_drawdown_pct` after risk metrics computation
- [x] Removed unused `treadtoolsContext` param from `buildSystemPrompt()`

### Phase 8: UI Component Fixes
- [x] Clamped progress bar: `Math.max(0, Math.min(100, ...))`
- [x] Fixed setTimeout leak in SettingsPanel with `useRef` + cleanup

### Phase 9: Security Headers & Encryption
- [x] Added CSP header to `next.config.ts`
- [x] Created `src/server/db/encryption.ts` (AES-256-GCM, `.master-key` file)
- [x] Integrated encryption into configStore: encrypt on write, decrypt on read, auto-migrate plaintext

### Phase 10: Dead Code Removal
- [x] Removed 6 dead constants: PROXY_BASE, CANVAS_DISPLAY_SIZE, DECISION_INTERVAL_MS, EQUITY_SNAPSHOT_INTERVAL_MS, MARKET_DATA_INTERVAL_MS, PET_SAVE_INTERVAL_MS
- [x] Removed 4 dead types: PnLSnapshot, PetEvent, AppConfig, ActivityLogEntry
- [x] Removed 7 dead store actions: setMood, setCumulativeVolume, setIsAlive, reset, setEngineRunning, setLastSyncTime, getEnabledAccounts
- [x] Removed `getAllTreadfiIds()` from repository.ts (+ unused `isNotNull` import)
- [x] Un-exported internal helpers: getStageForVolume, calculateHungerDecay, calculateStarvationDamage
- [x] Deduplicated `pickData` → `src/store/utils.ts`, imported from all 3 stores
- [x] Removed dead `getActiveBotsVolume()` from treadApi.ts
