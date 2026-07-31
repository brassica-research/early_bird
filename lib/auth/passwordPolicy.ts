import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Password policy, aligned with NIST SP 800-63B:
//   - length is the primary strength control (min 8, allow long passphrases);
//   - NO composition rules (no forced upper/lower/symbol) and no periodic
//     rotation;
//   - screen against known-breached passwords (OWASP): a small local list plus
//     a best-effort, privacy-preserving check against Have I Been Pwned using
//     k-anonymity (only the first 5 chars of the SHA-1 are ever sent).
// ---------------------------------------------------------------------------

const MIN_LENGTH = 8;
const RELAXED_MIN_LENGTH = 4;
const MAX_LENGTH = 100;

// Password strictness. STRICT (the default, and what production should use)
// enforces the NIST length floor, a common-password blocklist, and the HIBP
// breach screen. Setting AUTH_PASSWORD_POLICY=relaxed loosens this for LOCAL /
// TESTING only — a lower length floor, no blocklist, and no breach check — so
// throwaway test accounts are easy to create. Never set it in production.
function isRelaxed(): boolean {
  return (process.env.AUTH_PASSWORD_POLICY || "").toLowerCase() === "relaxed";
}

// A tiny local blocklist as a guaranteed floor if the network check is down.
const COMMON = new Set([
  "password",
  "password1",
  "12345678",
  "123456789",
  "qwertyui",
  "11111111",
  "iloveyou",
  "letmein1",
  "changeme",
  "admin123",
  "welcome1",
]);

export interface PolicyResult {
  ok: boolean;
  reason?: string;
}

/** Synchronous structural checks (length + local blocklist). */
export function checkPasswordPolicy(password: string): PolicyResult {
  const relaxed = isRelaxed();
  const min = relaxed ? RELAXED_MIN_LENGTH : MIN_LENGTH;
  if (password.length < min) {
    return { ok: false, reason: `Use at least ${min} characters.` };
  }
  if (password.length > MAX_LENGTH) {
    return { ok: false, reason: `Keep it under ${MAX_LENGTH} characters.` };
  }
  if (!relaxed && COMMON.has(password.toLowerCase())) {
    return { ok: false, reason: "That password is too common — choose another." };
  }
  return { ok: true };
}

/**
 * Best-effort breached-password check via HIBP k-anonymity. Returns true only
 * when the password is confirmed breached; network failures return false so a
 * HIBP outage never blocks a legitimate reset.
 */
export async function isBreachedPassword(password: string): Promise<boolean> {
  try {
    const sha1 = createHash("sha1")
      .update(password)
      .digest("hex")
      .toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    try {
      const res = await fetch(
        `https://api.pwnedpasswords.com/range/${prefix}`,
        {
          signal: controller.signal,
          headers: { "Add-Padding": "true", "User-Agent": "EarlyBird/1.0" },
        },
      );
      if (!res.ok) return false;
      const text = await res.text();
      for (const line of text.split("\n")) {
        const [hashSuffix, countStr] = line.trim().split(":");
        if (hashSuffix === suffix && Number(countStr) > 0) return true;
      }
      return false;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return false;
  }
}

/** Full validation: structural policy + breach screen. */
export async function validateNewPassword(
  password: string,
): Promise<PolicyResult> {
  const local = checkPasswordPolicy(password);
  if (!local.ok) return local;
  if (!isRelaxed() && (await isBreachedPassword(password))) {
    return {
      ok: false,
      reason:
        "This password has appeared in a known data breach — please choose a different one.",
    };
  }
  return { ok: true };
}
