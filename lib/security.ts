import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Shared security helpers for the staff portals (admin + technician).
//
// - In-memory rate limiting with exponential backoff for login endpoints.
// - Same-origin checks (CSRF defense-in-depth) for state-changing requests.
// - no-store responses so authenticated data isn't cached by proxies/browsers.
//
// The rate limiter is per-process (fine for a single instance / MVP). For a
// multi-instance deployment, back it with a shared store (Redis) — same API.
// ---------------------------------------------------------------------------

interface Attempt {
  count: number;
  first: number;
  blockedUntil: number;
}

const attempts = new Map<string, Attempt>();

export interface RateLimitOptions {
  /** Max attempts allowed within the window before blocking. */
  max: number;
  /** Sliding window in milliseconds. */
  windowMs: number;
  /** Base block duration; doubles for each block beyond the threshold. */
  baseBlockMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
}

/** Consume one attempt for `key`. Call on each login attempt. */
export function rateLimit(
  key: string,
  now: number,
  opts: RateLimitOptions,
): RateLimitResult {
  const rec = attempts.get(key);

  if (rec && rec.blockedUntil > now) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((rec.blockedUntil - now) / 1000),
    };
  }

  if (!rec || now - rec.first > opts.windowMs) {
    attempts.set(key, { count: 1, first: now, blockedUntil: 0 });
    return { allowed: true, retryAfterSec: 0 };
  }

  rec.count += 1;
  if (rec.count > opts.max) {
    // Exponential backoff: each block past the threshold doubles the wait.
    const overflow = rec.count - opts.max;
    const block = opts.baseBlockMs * Math.pow(2, Math.min(overflow - 1, 6));
    rec.blockedUntil = now + block;
    return { allowed: false, retryAfterSec: Math.ceil(block / 1000) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

/** Clear a key's attempts (call on successful login). */
export function rateLimitReset(key: string): void {
  attempts.delete(key);
}

/** Best-effort client IP from proxy headers. */
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return (
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

/**
 * Same-origin check for state-changing requests. Compares the request's Origin
 * (or Referer) host to the Host header. Returns true when they match or when no
 * Origin is present (non-browser clients). Combined with SameSite cookies this
 * is solid CSRF defense.
 */
export function isSameOrigin(request: Request): boolean {
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const source = origin || referer;
  if (!source) return true; // no browser origin (e.g. curl / native app)
  try {
    return new URL(source).host === host;
  } catch {
    return false;
  }
}

/** JSON response with caching disabled — use for authenticated staff data. */
export function noStoreJson(body: unknown, init?: ResponseInit): NextResponse {
  const res = NextResponse.json(body, init);
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.headers.set("Pragma", "no-cache");
  return res;
}

/** Reject cross-origin state-changing requests. Returns null when allowed. */
export function guardCsrf(request: Request): NextResponse | null {
  if (!isSameOrigin(request)) {
    return noStoreJson({ error: "Cross-origin request blocked." }, { status: 403 });
  }
  return null;
}
