/**
 * AES-256-GCM encryption for sensitive config values.
 *
 * Master key is stored at DATA_DIR/.master-key (32 bytes, mode 0600).
 * Generated on first use and reused thereafter.
 *
 * Encrypted values are stored as: `enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>`
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getSafeDefaultDataDir } from '@/server/middleware/auth';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // bytes
const IV_LENGTH = 12; // bytes for GCM
const PREFIX = 'enc:v1:';

// ---------------------------------------------------------------------------
// Master key management
// ---------------------------------------------------------------------------

let cachedKey: Buffer | null = null;

function getMasterKeyPath(): string {
  const dataDir = process.env.DATA_DIR || getSafeDefaultDataDir();
  return path.resolve(dataDir, '.master-key');
}

function getMasterKey(): Buffer {
  if (cachedKey) return cachedKey;

  const keyPath = getMasterKeyPath();

  try {
    const existing = fs.readFileSync(keyPath);
    if (existing.length === KEY_LENGTH) {
      cachedKey = existing;
      return cachedKey;
    }
    // Invalid key file -- regenerate
  } catch {
    // File doesn't exist -- generate below
  }

  const key = crypto.randomBytes(KEY_LENGTH);

  const dir = path.dirname(keyPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(keyPath, key, { mode: 0o600 });

  console.log(`[treadmagotchi/encryption] Master key written to: ${keyPath}`);

  cachedKey = key;
  return cachedKey;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns a prefixed string: `enc:v1:<iv>:<authTag>:<ciphertext>`
 */
export function encrypt(plaintext: string): string {
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${PREFIX}${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt a value previously encrypted with `encrypt()`.
 * Throws if the value is not a valid encrypted string or decryption fails.
 */
export function decrypt(encryptedValue: string): string {
  if (!isEncrypted(encryptedValue)) {
    throw new Error('Value is not encrypted');
  }

  const key = getMasterKey();
  const parts = encryptedValue.slice(PREFIX.length).split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted value');
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Check whether a value is already encrypted (starts with the prefix).
 */
export function isEncrypted(value: string): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}
