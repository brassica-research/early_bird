import { createHmac, randomBytes, timingSafeEqual } from "crypto";

// ---------------------------------------------------------------------------
// TOTP (RFC 6238) — time-based one-time passwords, dependency-free.
//
// Reused by both the admin second factor and optional per-technician 2FA.
// SHA-1, 6 digits, 30-second step (the defaults every authenticator app uses),
// with a ±1 step verification window for clock skew. Comparison is constant
// time.
// ---------------------------------------------------------------------------

const DIGITS = 6;
const STEP_SECONDS = 30;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Generate a new base32 TOTP secret (default 20 bytes / 160 bits). */
export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

/** otpauth:// URI for enrolling in an authenticator app (and QR encoding). */
export function otpauthUrl(
  secret: string,
  accountLabel: string,
  issuer = "Early Bird",
): string {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Compute the TOTP code for a given secret at a given time (ms). */
export function totpAt(secret: string, timeMs: number): string {
  const counter = Math.floor(timeMs / 1000 / STEP_SECONDS);
  return hotp(base32Decode(secret), counter);
}

/**
 * Verify a submitted code against the secret, allowing ±`window` steps of
 * clock drift. `nowMs` is injectable for testing.
 */
export function verifyTotp(
  secret: string,
  token: string,
  window = 1,
  nowMs: number = Date.now(),
): boolean {
  const cleaned = (token || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;
  let key: Buffer;
  try {
    key = base32Decode(secret);
  } catch {
    return false;
  }
  const counter = Math.floor(nowMs / 1000 / STEP_SECONDS);
  for (let i = -window; i <= window; i++) {
    const candidate = hotp(key, counter + i);
    if (constantTimeEqual(candidate, cleaned)) return true;
  }
  return false;
}

// --- HOTP core -------------------------------------------------------------

function hotp(key: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  // 64-bit big-endian counter (safe for values well beyond year 9999).
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (bin % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// --- base32 (RFC 4648, no padding) -----------------------------------------

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error("Invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
