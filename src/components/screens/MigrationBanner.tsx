'use client';

import { useState, useCallback } from 'react';
import PixelButton from '@/components/ui/PixelButton';

// ---------------------------------------------------------------------------
// IndexedDB helpers (raw API -- Dexie has been removed)
// ---------------------------------------------------------------------------

const LEGACY_DB_NAME = 'TreadmagotchiDB';
const LEGACY_STORES = [
  'trades',
  'tradeOutcomes',
  'pnlSnapshots',
  'events',
  'activityLog',
] as const;

const LEGACY_LOCALSTORAGE_KEYS = [
  'treadmagotchi-pet',
  'treadmagotchi-config',
  'treadmagotchi-onboarded',
] as const;

function openLegacyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(LEGACY_DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function readAllFromStore(
  db: IDBDatabase,
  storeName: string,
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch {
      // Store doesn't exist in this version of the DB
      resolve([]);
    }
  });
}

// ---------------------------------------------------------------------------
// Public helpers used by page.tsx to decide whether to render the banner
// ---------------------------------------------------------------------------

/** Returns true if the legacy TreadmagotchiDB exists and has at least one record. */
export async function hasLegacyIndexedDBData(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;

  try {
    const db = await openLegacyDb();
    for (const storeName of LEGACY_STORES) {
      if (!db.objectStoreNames.contains(storeName)) continue;
      const rows = await readAllFromStore(db, storeName);
      if (rows.length > 0) {
        db.close();
        return true;
      }
    }
    db.close();
    return false;
  } catch {
    return false;
  }
}

/** Returns true if the server has zero trades. */
export async function serverHasNoTrades(): Promise<boolean> {
  try {
    const res = await fetch('/api/trades?limit=1', {

    });
    if (!res.ok) return false;
    const data = await res.json();
    return !data.trades || data.trades.length === 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MigrationPhase =
  | 'idle'
  | 'reading'
  | 'uploading'
  | 'success'
  | 'error';

interface MigrationCounts {
  trades: number;
  outcomes: number;
  pnlSnapshots: number;
  events: number;
  activityLog: number;
  petState: boolean;
}

interface MigrationBannerProps {
  onComplete: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MigrationBanner({ onComplete }: MigrationBannerProps) {
  const [phase, setPhase] = useState<MigrationPhase>('idle');
  const [counts, setCounts] = useState<MigrationCounts | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const handleSkip = useCallback(() => {
    sessionStorage.setItem('migration-dismissed', '1');
    onComplete();
  }, [onComplete]);

  const handleMigrate = useCallback(async () => {
    setPhase('reading');
    setErrorMessage('');

    try {
      // ----- 1. Read all data from IndexedDB -----
      const db = await openLegacyDb();

      const readSafe = async (name: string) => {
        if (!db.objectStoreNames.contains(name)) return [];
        return readAllFromStore(db, name);
      };

      const [
        tradeRows,
        outcomeRows,
        snapshotRows,
        eventRows,
        activityRows,
      ] = await Promise.all([
        readSafe('trades'),
        readSafe('tradeOutcomes'),
        readSafe('pnlSnapshots'),
        readSafe('events'),
        readSafe('activityLog'),
      ]);

      db.close();

      // ----- 2. Read pet state from localStorage -----
      let petState: Record<string, unknown> | undefined;
      try {
        const raw = localStorage.getItem('treadmagotchi-pet');
        if (raw) {
          petState = JSON.parse(raw);
        }
      } catch {
        // Corrupted localStorage -- skip pet state
      }

      const currentCounts: MigrationCounts = {
        trades: tradeRows.length,
        outcomes: outcomeRows.length,
        pnlSnapshots: snapshotRows.length,
        events: eventRows.length,
        activityLog: activityRows.length,
        petState: !!petState,
      };
      setCounts(currentCounts);

      // ----- 3. POST to /api/migrate -----
      setPhase('uploading');

      const res = await fetch('/api/migrate', {
        method: 'POST',
  
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trades: tradeRows,
          outcomes: outcomeRows,
          pnlSnapshots: snapshotRows,
          events: eventRows,
          activityLog: activityRows,
          petState,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || `Server responded with ${res.status}`);
      }

      // ----- 4. Success -- clear legacy localStorage keys -----
      for (const key of LEGACY_LOCALSTORAGE_KEYS) {
        localStorage.removeItem(key);
      }

      setPhase('success');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Unknown error during migration',
      );
      setPhase('error');
    }
  }, []);

  // ------- Render -------

  return (
    <div className="w-full max-w-md mx-auto mb-4 bg-pixel-dark border-2 border-pixel-yellow/60 rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-pixel-yellow text-[10px]">!</span>
        <h2 className="text-[10px] text-pixel-yellow font-pixel">
          DATA MIGRATION
        </h2>
      </div>

      {/* Idle state -- prompt the user */}
      {phase === 'idle' && (
        <>
          <p className="text-[9px] opacity-80 mb-3 leading-relaxed">
            Migrate your data from browser storage to the server. Your trading
            history, pet state, and activity log will be transferred.
          </p>
          <p className="text-[8px] text-pixel-red/90 mb-4 leading-relaxed">
            Warning: Clear your browser data BEFORE migrating and you will
            permanently lose your trading history.
          </p>
          <div className="flex gap-2">
            <PixelButton onClick={handleMigrate} variant="primary">
              Migrate Now
            </PixelButton>
            <PixelButton onClick={handleSkip} variant="ghost">
              Skip
            </PixelButton>
          </div>
        </>
      )}

      {/* Reading from IndexedDB */}
      {phase === 'reading' && (
        <p className="text-[9px] opacity-70 animate-pulse">
          Reading browser data...
        </p>
      )}

      {/* Uploading to server */}
      {phase === 'uploading' && counts && (
        <p className="text-[9px] opacity-70 animate-pulse">
          Migrating... ({counts.trades} trades, {counts.outcomes} outcomes,{' '}
          {counts.pnlSnapshots} snapshots)
        </p>
      )}

      {/* Success */}
      {phase === 'success' && counts && (
        <>
          <p className="text-[9px] text-pixel-green mb-2">
            Migration complete!
          </p>
          <ul className="text-[8px] opacity-70 mb-3 space-y-0.5">
            <li>{counts.trades} trades</li>
            <li>{counts.outcomes} trade outcomes</li>
            <li>{counts.pnlSnapshots} PnL snapshots</li>
            <li>{counts.events} events</li>
            <li>{counts.activityLog} activity log entries</li>
            {counts.petState && <li>Pet state restored</li>}
          </ul>
          <PixelButton onClick={onComplete} variant="primary">
            Continue
          </PixelButton>
        </>
      )}

      {/* Error */}
      {phase === 'error' && (
        <>
          <p className="text-[9px] text-pixel-red mb-2">Migration failed</p>
          <p className="text-[8px] opacity-60 mb-3 break-words">
            {errorMessage}
          </p>
          <div className="flex gap-2">
            <PixelButton onClick={handleMigrate} variant="danger">
              Retry
            </PixelButton>
            <PixelButton onClick={handleSkip} variant="ghost">
              Skip
            </PixelButton>
          </div>
        </>
      )}
    </div>
  );
}
