/**
 * Security middleware for Treadmagotchi API routes.
 *
 * - Host header validation (DNS rebinding protection)
 * - Sliding-window rate limiting (in-memory)
 *
 * Authentication is handled by localhost-only host validation —
 * no bearer tokens or session cookies needed.
 */
import os from 'node:os';
import path from 'node:path';
import { NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];

// ---------------------------------------------------------------------------
// Rate limit store (in-memory, survives HMR via globalThis)
// ---------------------------------------------------------------------------

const globalForAuth = globalThis as unknown as {
  __treadRateLimits: Map<string, { timestamps: number[] }> | undefined;
};

function getRateLimitStore(): Map<string, { timestamps: number[] }> {
  if (!globalForAuth.__treadRateLimits) {
    globalForAuth.__treadRateLimits = new Map();
  }
  return globalForAuth.__treadRateLimits;
}

// ---------------------------------------------------------------------------
// Data directory helper (used by encryption.ts)
// ---------------------------------------------------------------------------

export function getSafeDefaultDataDir(): string {
  if (process.platform === 'darwin') return path.join(os.homedir(), '.local', 'share', 'treadmagotchi');
  if (process.platform === 'win32') return path.join(os.homedir(), 'AppData', 'Local', 'treadmagotchi');
  const xdg = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(xdg, 'treadmagotchi');
}

// ---------------------------------------------------------------------------
// Host header validation (DNS rebinding protection)
// ---------------------------------------------------------------------------

/**
 * Validate the Host header against an allowlist.
 * Rejects X-Forwarded-Host unless REVERSE_PROXY=true.
 * Validates Origin on POST/DELETE requests.
 */
export function validateHost(request: Request): boolean {
  // Next.js internally sets x-forwarded-host on all requests (even without a proxy).
  // Only reject x-forwarded-host if it differs from the Host header AND we are
  // not behind a trusted reverse proxy.
  const forwardedHost = request.headers.get('x-forwarded-host');
  const rawHost = request.headers.get('host');
  if (forwardedHost && process.env.REVERSE_PROXY !== 'true' && forwardedHost !== rawHost) {
    return false;
  }

  const effectiveHost = (process.env.REVERSE_PROXY === 'true' && forwardedHost)
    ? forwardedHost
    : rawHost;

  if (!effectiveHost) {
    return false;
  }

  // Strip port from host (handles "localhost:3000", "[::1]:3000", etc.)
  let hostname = effectiveHost;
  if (hostname.startsWith('[')) {
    // IPv6: [::1]:3000 -> [::1]
    const bracketEnd = hostname.indexOf(']');
    if (bracketEnd !== -1) {
      hostname = hostname.slice(0, bracketEnd + 1);
    }
  } else {
    // hostname:port -> hostname
    const colonIdx = hostname.lastIndexOf(':');
    if (colonIdx !== -1) {
      hostname = hostname.slice(0, colonIdx);
    }
  }

  if (!ALLOWED_HOSTS.includes(hostname)) {
    return false;
  }

  // Validate Origin on mutating requests
  const method = request.method.toUpperCase();
  if (method === 'POST' || method === 'DELETE') {
    const origin = request.headers.get('origin');
    if (origin) {
      try {
        const originUrl = new URL(origin);
        const originHostname = originUrl.hostname;
        if (!ALLOWED_HOSTS.includes(originHostname) && !ALLOWED_HOSTS.includes(`[${originHostname}]`)) {
          return false;
        }
      } catch {
        return false;
      }
    }
    // Origin may be absent for same-origin requests in some browsers -- that is OK
  }

  return true;
}

// ---------------------------------------------------------------------------
// Rate limiting (sliding window)
// ---------------------------------------------------------------------------

/**
 * Sliding-window rate limiter backed by an in-memory Map.
 *
 * @param key      - Unique key (e.g. "config-keys" or IP-based)
 * @param maxReqs  - Maximum requests allowed in the window
 * @param windowMs - Window duration in milliseconds
 * @returns { allowed: true } or { allowed: false, retryAfter: seconds }
 */
export function rateLimit(
  key: string,
  maxReqs: number,
  windowMs: number,
): { allowed: boolean; retryAfter?: number } {
  const store = getRateLimitStore();
  const now = Date.now();
  const cutoff = now - windowMs;

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Prune timestamps outside the window
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= maxReqs) {
    const oldestInWindow = entry.timestamps[0];
    const retryAfterMs = oldestInWindow + windowMs - now;
    return {
      allowed: false,
      retryAfter: Math.ceil(retryAfterMs / 1000),
    };
  }

  entry.timestamps.push(now);
  return { allowed: true };
}

// ---------------------------------------------------------------------------
// withAuth wrapper
// ---------------------------------------------------------------------------

type RouteHandler = (request: Request) => Promise<NextResponse> | NextResponse;

/**
 * Wraps a Next.js route handler with host validation.
 *
 * Returns 403 for host validation failures.
 * On success, calls through to the wrapped handler.
 */
export function withAuth(handler: RouteHandler): RouteHandler {
  return async (request: Request) => {
    if (!validateHost(request)) {
      return NextResponse.json(
        { error: 'Forbidden: invalid host' },
        { status: 403 },
      );
    }

    return handler(request);
  };
}
