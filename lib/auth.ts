// ---------------------------------------------------------------------------
// Admin session auth — a lightweight, dependency-free signed-cookie scheme.
//
// A successful password login mints an HMAC-signed token (payload = expiry).
// Middleware verifies the signature + expiry on every protected request. Uses
// the Web Crypto API (globalThis.crypto.subtle), so the SAME code runs in the
// Edge middleware runtime and in Node route handlers.
//
// This is deliberately simple: a single shared admin password gated by env,
// suitable for a single-operator ops dashboard. For multi-user accounts, swap
// this for a real identity provider.
// ---------------------------------------------------------------------------

export const ADMIN_COOKIE = "eb_admin";
export const TECH_COOKIE = "eb_tech";
const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

const encoder = new TextEncoder();

/** The signing secret: explicit secret if set, else derived from the password. */
export function getAdminSecret(): string | null {
  const explicit = process.env.ADMIN_SESSION_SECRET;
  if (explicit && explicit.length > 0) return explicit;
  const pw = process.env.ADMIN_PASSWORD;
  if (pw && pw.length > 0) return `derived:${pw}`;
  return null;
}

export function getAdminPassword(): string | null {
  const pw = process.env.ADMIN_PASSWORD;
  return pw && pw.length > 0 ? pw : null;
}

/** True when admin auth is configured (a password is set). */
export function isAdminConfigured(): boolean {
  return getAdminPassword() !== null;
}

/** Technician passcode gate — same signed-cookie scheme as admin. */
export function getTechSecret(): string | null {
  const explicit = process.env.TECH_SESSION_SECRET;
  if (explicit && explicit.length > 0) return explicit;
  const pc = process.env.TECH_PASSCODE;
  if (pc && pc.length > 0) return `derived-tech:${pc}`;
  return null;
}

export function getTechPasscode(): string | null {
  const pc = process.env.TECH_PASSCODE;
  return pc && pc.length > 0 ? pc : null;
}

export function isTechConfigured(): boolean {
  return getTechPasscode() !== null;
}

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/**
 * Create a signed session token that expires `ttlMs` from now, optionally
 * carrying a `subject` claim (e.g. the technician's account id). The subject is
 * part of the signed payload, so it can't be forged or altered by the client.
 * Payload format: `<exp>|<subjectB64>` (neither part contains a dot).
 */
export async function createSessionToken(
  secret: string,
  subject: string = "",
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<string> {
  const exp = Date.now() + ttlMs;
  const payload = `${exp}|${toBase64Url(encoder.encode(subject))}`;
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return `${payload}.${toBase64Url(sig)}`;
}

async function parseSession(
  secret: string,
  token: string | undefined,
): Promise<{ subject: string } | null> {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);

  const bar = payload.indexOf("|");
  const expStr = bar === -1 ? payload : payload.slice(0, bar);
  const subjectB64 = bar === -1 ? "" : payload.slice(bar + 1);

  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return null;

  let sigBytes: Uint8Array<ArrayBuffer>;
  try {
    sigBytes = fromBase64Url(sigPart);
  } catch {
    return null;
  }
  const key = await importKey(secret);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes,
    encoder.encode(payload),
  );
  if (!valid) return null;

  let subject = "";
  try {
    subject = new TextDecoder().decode(fromBase64Url(subjectB64));
  } catch {
    subject = "";
  }
  return { subject };
}

/** Verify a session token's signature and expiry. */
export async function verifySessionToken(
  secret: string,
  token: string | undefined,
): Promise<boolean> {
  return (await parseSession(secret, token)) !== null;
}

/** Return the token's subject claim (e.g. tech id), or null if invalid. */
export async function readSessionSubject(
  secret: string,
  token: string | undefined,
): Promise<string | null> {
  const s = await parseSession(secret, token);
  return s ? s.subject : null;
}

/** Constant-time-ish string comparison for the password check. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
