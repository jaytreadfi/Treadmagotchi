/**
 * SQLite database connection singleton.
 *
 * Uses better-sqlite3 for the raw connection and drizzle-orm for typed queries.
 * The globalThis pattern ensures a single connection survives HMR in development.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DbInstance = {
  raw: InstanceType<typeof Database>;
  orm: BetterSQLite3Database<typeof schema>;
  walTimer: ReturnType<typeof setInterval> | null;
};

const globalForDb = globalThis as unknown as {
  __treadDb: DbInstance | undefined;
};

// ---------------------------------------------------------------------------
// iCloud sync warning
// ---------------------------------------------------------------------------

const ICLOUD_DANGER_PREFIXES = [
  path.join(os.homedir(), 'Desktop'),
  path.join(os.homedir(), 'Documents'),
  path.join(os.homedir(), 'Library', 'Mobile Documents'),
];

function warnIfICloudSynced(dirPath: string): void {
  const resolved = path.resolve(dirPath);
  for (const prefix of ICLOUD_DANGER_PREFIXES) {
    if (resolved.startsWith(prefix)) {
      console.warn(
        `[treadmagotchi/db] WARNING: Data directory "${resolved}" is inside "${prefix}" ` +
          'which may be synced by iCloud. This can corrupt the SQLite database. ' +
          'Set DATA_DIR to a path outside of iCloud-synced folders.',
      );
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Secure directory & file helpers
// ---------------------------------------------------------------------------

function ensureDataDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
  try {
    fs.chmodSync(dirPath, 0o700);
  } catch {
    // chmod may fail on Windows — non-fatal
  }
}

function secureDatabaseFile(filePath: string): void {
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // chmod may fail on Windows — non-fatal
  }
}

// ---------------------------------------------------------------------------
// Connection factory
// ---------------------------------------------------------------------------

function getSafeDefaultDataDir(): string {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), '.local', 'share', 'treadmagotchi');
  }
  if (process.platform === 'win32') {
    return path.join(os.homedir(), 'AppData', 'Local', 'treadmagotchi');
  }
  // Linux / other
  const xdg = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(xdg, 'treadmagotchi');
}

function createConnection(): DbInstance {
  const dataDir = process.env.DATA_DIR || getSafeDefaultDataDir();
  const resolvedDir = path.resolve(dataDir);

  warnIfICloudSynced(resolvedDir);
  ensureDataDir(resolvedDir);

  const dbPath = path.join(resolvedDir, 'treadmagotchi.db');
  const raw = new Database(dbPath);

  // Secure the file after creation
  secureDatabaseFile(dbPath);

  // ── PRAGMAs ──
  raw.pragma('journal_mode = WAL');
  raw.pragma('busy_timeout = 5000');
  raw.pragma('foreign_keys = ON');
  raw.pragma('synchronous = NORMAL');
  raw.pragma('cache_size = -16000'); // 16 MB
  raw.pragma('temp_store = MEMORY');

  // ── Drizzle wrapper ──
  const orm = drizzle(raw, { schema });

  // ── Auto-migrate on startup ──
  // During `next build`, multiple workers may import this module concurrently.
  // Retry with backoff to handle SQLITE_BUSY from concurrent migration attempts.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      migrate(orm, { migrationsFolder: path.resolve(process.cwd(), 'drizzle') });
      break;
    } catch (err) {
      const msg = String(err);
      if (msg.includes('already been applied')) break;
      if (msg.includes('SQLITE_BUSY') && attempt < 2) {
        // Another worker is running migrations — wait and retry
        const delay = 500 * (attempt + 1);
        const start = Date.now();
        while (Date.now() - start < delay) { /* busy wait — better-sqlite3 is sync */ }
        continue;
      }
      console.error('[treadmagotchi/db] Migration failed:', err);
      break;
    }
  }

  // ── Periodic WAL checkpoint (every hour) ──
  const walTimer = setInterval(() => {
    try {
      raw.pragma('wal_checkpoint(TRUNCATE)');
    } catch (err) {
      console.error('[treadmagotchi/db] WAL checkpoint failed:', err);
    }
  }, 60 * 60 * 1000);

  // Prevent the timer from keeping the process alive
  if (walTimer.unref) {
    walTimer.unref();
  }

  console.log(`[treadmagotchi/db] Connected to ${dbPath}`);

  return { raw, orm, walTimer };
}

// ---------------------------------------------------------------------------
// Singleton accessor
// ---------------------------------------------------------------------------

function getInstance(): DbInstance {
  if (!globalForDb.__treadDb) {
    globalForDb.__treadDb = createConnection();
  }
  return globalForDb.__treadDb;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/** Raw better-sqlite3 Database instance. Use for manual SQL or migrations. */
export const sqlite = getInstance().raw;

/** Drizzle ORM instance with full schema typing. Use for all application queries. */
export const db = getInstance().orm;

/**
 * Gracefully close the database connection.
 * Call this on process shutdown (SIGINT / SIGTERM).
 */
export function closeDb(): void {
  const instance = globalForDb.__treadDb;
  if (!instance) return;

  if (instance.walTimer) {
    clearInterval(instance.walTimer);
  }

  try {
    // Final WAL checkpoint before closing
    instance.raw.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    // Best-effort
  }

  try {
    instance.raw.close();
  } catch {
    // Already closed or otherwise unavailable
  }

  globalForDb.__treadDb = undefined;
  console.log('[treadmagotchi/db] Connection closed.');
}
