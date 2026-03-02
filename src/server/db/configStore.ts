/**
 * Config key-value store backed by SQLite.
 *
 * Reads/writes the `config` table and keeps an audit trail in `config_history`.
 * Known keys are validated on write. API key values are redacted in history.
 */
import { eq } from 'drizzle-orm';
import { db, sqlite } from './index';
import { config, configHistory } from './schema';
import { encrypt, decrypt, isEncrypted } from './encryption';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Keys whose actual values must never appear in config_history. */
const SENSITIVE_KEY_PATTERNS = [
  'api_key',
  'api_secret',
  'passphrase',
  'secret',
];

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((p) => lower.includes(p));
}

function redactForHistory(key: string, value: unknown): string {
  if (isSensitiveKey(key)) return '"[configured]"';
  return JSON.stringify(value);
}

/** Keys that change frequently and don't need audit trail entries. */
const SKIP_AUDIT_KEYS = new Set(['last_sync_time', 'last_decision_time', 'last_drawdown_pct']);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface AccountEntry {
  name: string;
  id: string;
  exchange: string;
  enabled: boolean;
}

type Validator = (value: unknown) => void;

const validators: Record<string, Validator> = {
  decision_interval_seconds(value: unknown) {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new Error('decision_interval_seconds must be an integer');
    }
    if (value < 60 || value > 600) {
      throw new Error('decision_interval_seconds must be between 60 and 600');
    }
  },

  mode(value: unknown) {
    if (value !== 'auto' && value !== 'manual') {
      throw new Error("mode must be 'auto' or 'manual'");
    }
  },

  initial_capital(value: unknown) {
    if (typeof value !== 'number' || value <= 0) {
      throw new Error('initial_capital must be a positive number');
    }
    if (value > 10_000_000) {
      throw new Error('initial_capital cannot exceed 10,000,000');
    }
  },

  pet_name(value: unknown) {
    if (typeof value !== 'string') {
      throw new Error('pet_name must be a string');
    }
    if (value.length > 20) {
      throw new Error('pet_name must be 20 characters or fewer');
    }
    if (!/^[a-zA-Z0-9 ]+$/.test(value)) {
      throw new Error('pet_name must contain only alphanumeric characters and spaces');
    }
  },

  accounts(value: unknown) {
    if (!Array.isArray(value)) {
      throw new Error('accounts must be an array');
    }
    if (value.length > 10) {
      throw new Error('accounts may contain at most 10 entries');
    }
    for (const [i, entry] of value.entries()) {
      const acct = entry as Partial<AccountEntry>;
      if (typeof acct.name !== 'string' || acct.name.length === 0) {
        throw new Error(`accounts[${i}].name must be a non-empty string`);
      }
      if (typeof acct.id !== 'string' || acct.id.length === 0) {
        throw new Error(`accounts[${i}].id must be a non-empty string`);
      }
      if (typeof acct.exchange !== 'string' || acct.exchange.length === 0) {
        throw new Error(`accounts[${i}].exchange must be a non-empty string`);
      }
      if (typeof acct.enabled !== 'boolean') {
        throw new Error(`accounts[${i}].enabled must be a boolean`);
      }
    }
  },
};

/** API key fields share the same validator. */
function validateApiKey(value: unknown): void {
  if (typeof value !== 'string') {
    throw new Error('API key must be a string');
  }
  if (value.length < 8 || value.length > 256) {
    throw new Error('API key must be between 8 and 256 characters');
  }
}

const API_KEY_SUFFIXES = ['api_key', 'api_secret', 'passphrase'];

function getValidator(key: string): Validator | null {
  if (validators[key]) return validators[key];

  const lower = key.toLowerCase();
  for (const suffix of API_KEY_SUFFIXES) {
    if (lower.endsWith(suffix) || lower.includes(suffix)) {
      return validateApiKey;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read a config value by key. Returns `null` if the key does not exist.
 * The stored JSON string is parsed into `T`.
 * Sensitive values are decrypted transparently. Plaintext values are
 * auto-migrated to encrypted form on first read.
 */
export function getConfig<T>(key: string): T | null {
  const row = db
    .select()
    .from(config)
    .where(eq(config.key, key))
    .get();

  if (!row) return null;

  const rawValue = row.value;

  // Transparent decryption for sensitive keys
  if (isSensitiveKey(key)) {
    const parsed = JSON.parse(rawValue);
    if (typeof parsed === 'string' && isEncrypted(parsed)) {
      return decrypt(parsed) as T;
    }
    // Plaintext sensitive value — auto-migrate to encrypted form
    if (typeof parsed === 'string' && parsed.length > 0) {
      try {
        const encrypted = encrypt(parsed);
        const encJsonValue = JSON.stringify(encrypted);
        db.insert(config)
          .values({ key, value: encJsonValue, updated_at: Date.now() })
          .onConflictDoUpdate({
            target: config.key,
            set: { value: encJsonValue, updated_at: Date.now() },
          })
          .run();
      } catch {
        // Migration failed -- return plaintext, will retry next read
      }
      return parsed as T;
    }
  }

  return JSON.parse(rawValue) as T;
}

/**
 * Write a config value. The value is JSON-stringified before storage.
 * Known keys are validated before writing. An audit row is always written
 * to `config_history`.
 */
export function setConfig(key: string, value: unknown): void {
  // Validate known keys
  const validator = getValidator(key);
  if (validator) {
    validator(value);
  }

  const now = Date.now();
  // Encrypt sensitive values before storage
  const storageValue = (isSensitiveKey(key) && typeof value === 'string' && value.length > 0)
    ? encrypt(value)
    : value;
  const jsonValue = JSON.stringify(storageValue);

  sqlite.transaction(() => {
    // Read the current value for audit trail
    const existing = db
      .select()
      .from(config)
      .where(eq(config.key, key))
      .get();

    const oldValue = existing ? existing.value : null;

    // Upsert into config
    db.insert(config)
      .values({ key, value: jsonValue, updated_at: now })
      .onConflictDoUpdate({
        target: config.key,
        set: { value: jsonValue, updated_at: now },
      })
      .run();

    // Skip audit for frequently-changing keys
    if (SKIP_AUDIT_KEYS.has(key)) return;

    // Write audit history (redact sensitive values)
    const redactedOld = oldValue !== null
      ? redactForHistory(key, JSON.parse(oldValue))
      : null;
    const redactedNew = redactForHistory(key, value);

    db.insert(configHistory)
      .values({
        key,
        old_value: redactedOld,
        new_value: redactedNew,
        changed_at: now,
      })
      .run();
  })();
}

/**
 * Return every config entry as a flat `{ key: parsedValue }` object.
 * WARNING: Returns raw values including secrets. Caller must redact before exposing to clients.
 */
export function getAllConfig(): Record<string, unknown> {
  const rows = db.select().from(config).all();

  const result: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.value);
      // Decrypt sensitive values transparently
      if (isSensitiveKey(row.key) && typeof parsed === 'string' && isEncrypted(parsed)) {
        result[row.key] = decrypt(parsed);
      } else {
        result[row.key] = parsed;
      }
    } catch {
      // If a value somehow isn't valid JSON, expose the raw string
      result[row.key] = row.value;
    }
  }
  return result;
}
