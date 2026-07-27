import { randomBytes, createHash, randomUUID } from "crypto";
import { getInitializedStore } from "@/lib/store";
import { getTechPasscode, safeEqual } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { validateNewPassword } from "@/lib/auth/passwordPolicy";
import { verifyTotp, generateTotpSecret, otpauthUrl } from "@/lib/auth/totp";
import { sendEmail } from "@/lib/notify/email";
import { passwordResetEmail } from "@/lib/notify/templates";
import type { TechnicianAccount } from "@/lib/types";

// ---------------------------------------------------------------------------
// Technician account lifecycle: registration (gated by an invite passcode),
// login, and NIST/OWASP-aligned password reset (single-use, hashed,
// time-limited tokens; no account-existence disclosure).
// ---------------------------------------------------------------------------

const RESET_TTL_MINUTES = 30;

/** A dummy hash to verify against when an email is unknown — defeats timing
 *  side-channels that would otherwise reveal whether an account exists. */
const DUMMY_HASH =
  "scrypt$32768$8$1$00000000000000000000000000000000$" +
  "0000000000000000000000000000000000000000000000000000000000000000";

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export interface RegisterResult {
  ok: boolean;
  account?: TechnicianAccount;
  reason?: string;
  field?: string;
}

export async function registerTech(params: {
  inviteCode: string;
  name: string;
  email: string;
  password: string;
}): Promise<RegisterResult> {
  const invite = getTechPasscode();
  if (!invite) {
    return { ok: false, reason: "Technician sign-up is not configured." };
  }
  if (!safeEqual(params.inviteCode, invite)) {
    return { ok: false, reason: "Invalid invite code.", field: "inviteCode" };
  }

  const email = params.email.trim().toLowerCase();
  const name = params.name.trim();
  if (!name) return { ok: false, reason: "Enter your name.", field: "name" };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, reason: "Enter a valid email.", field: "email" };
  }

  const policy = await validateNewPassword(params.password);
  if (!policy.ok) {
    return { ok: false, reason: policy.reason, field: "password" };
  }

  const store = await getInitializedStore();
  if (await store.getTechAccountByEmail(email)) {
    return {
      ok: false,
      reason: "An account with that email already exists. Try signing in.",
      field: "email",
    };
  }

  const now = new Date().toISOString();
  const account: TechnicianAccount = {
    id: randomUUID(),
    name,
    email,
    passwordHash: await hashPassword(params.password),
    createdAt: now,
    updatedAt: now,
  };
  await store.createTechAccount(account);
  return { ok: true, account };
}

export interface LoginResult {
  ok: boolean;
  account?: TechnicianAccount;
  reason?: string;
  /** True when the password was right but a valid second factor is still needed. */
  need2fa?: boolean;
}

export async function loginTech(
  email: string,
  password: string,
  token?: string,
): Promise<LoginResult> {
  const store = await getInitializedStore();
  const account = await store.getTechAccountByEmail(email.trim().toLowerCase());
  // Always run a verification (real or dummy) so response time doesn't reveal
  // whether the email exists.
  const ok = await verifyPassword(password, account?.passwordHash ?? DUMMY_HASH);
  if (!account || account.disabled || !ok) {
    return { ok: false, reason: "Incorrect email or password." };
  }

  // Second factor, when the technician has enrolled one.
  if (account.totpEnabled && account.totpSecret) {
    if (!token) {
      return { ok: false, need2fa: true, reason: "Authenticator code required." };
    }
    if (!verifyTotp(account.totpSecret, token)) {
      return { ok: false, need2fa: true, reason: "Incorrect authenticator code." };
    }
  }

  return { ok: true, account };
}

/**
 * Begin a password reset. Always resolves the same way regardless of whether
 * the email is registered (no account-existence disclosure). When it is, a
 * single-use, hashed, time-limited token is stored and emailed.
 */
export async function requestPasswordReset(
  email: string,
  baseUrl: string,
): Promise<void> {
  const store = await getInitializedStore();
  const account = await store.getTechAccountByEmail(email.trim().toLowerCase());
  if (!account) return;

  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = sha256Hex(rawToken);
  const now = Date.now();
  await store.createResetToken({
    tokenHash,
    techId: account.id,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + RESET_TTL_MINUTES * 60_000).toISOString(),
    usedAt: null,
  });

  const resetUrl = `${baseUrl.replace(/\/$/, "")}/tech/reset?token=${rawToken}`;
  try {
    await sendEmail(
      passwordResetEmail(account.email, account.name, resetUrl, RESET_TTL_MINUTES),
    );
  } catch (err) {
    console.error("Reset email failed:", err);
  }
}

export interface ResetResult {
  ok: boolean;
  reason?: string;
}

// --- Technician two-factor (TOTP) enrollment -------------------------------

export interface Setup2faResult {
  ok: boolean;
  secret?: string;
  otpauthUrl?: string;
  reason?: string;
}

/** Begin 2FA enrollment: mint a secret (not yet enabled) and return it. */
export async function setupTech2fa(techId: string): Promise<Setup2faResult> {
  const store = await getInitializedStore();
  const account = await store.getTechAccountById(techId);
  if (!account) return { ok: false, reason: "Account not found." };
  const secret = generateTotpSecret();
  // Stored but not enabled until a code is verified.
  await store.updateTechTotp(techId, secret, false);
  return {
    ok: true,
    secret,
    otpauthUrl: otpauthUrl(secret, account.email),
  };
}

/** Finish enrollment: verify a code against the pending secret and enable 2FA. */
export async function enableTech2fa(
  techId: string,
  token: string,
): Promise<{ ok: boolean; reason?: string }> {
  const store = await getInitializedStore();
  const account = await store.getTechAccountById(techId);
  if (!account || !account.totpSecret) {
    return { ok: false, reason: "Start setup first." };
  }
  if (!verifyTotp(account.totpSecret, token)) {
    return { ok: false, reason: "That code didn't match — try again." };
  }
  await store.updateTechTotp(techId, account.totpSecret, true);
  return { ok: true };
}

/** Disable 2FA — requires a current valid code to prove possession. */
export async function disableTech2fa(
  techId: string,
  token: string,
): Promise<{ ok: boolean; reason?: string }> {
  const store = await getInitializedStore();
  const account = await store.getTechAccountById(techId);
  if (!account || !account.totpSecret || !account.totpEnabled) {
    return { ok: false, reason: "Two-factor isn't enabled." };
  }
  if (!verifyTotp(account.totpSecret, token)) {
    return { ok: false, reason: "Incorrect code." };
  }
  await store.updateTechTotp(techId, null, false);
  return { ok: true };
}

export async function resetPassword(
  rawToken: string,
  newPassword: string,
): Promise<ResetResult> {
  const store = await getInitializedStore();
  const record = await store.getResetToken(sha256Hex(rawToken));
  const invalidMsg = "This reset link is invalid or has expired.";
  if (!record || record.usedAt) return { ok: false, reason: invalidMsg };
  if (new Date(record.expiresAt).getTime() < Date.now()) {
    return { ok: false, reason: invalidMsg };
  }

  const policy = await validateNewPassword(newPassword);
  if (!policy.ok) return { ok: false, reason: policy.reason };

  const account = await store.getTechAccountById(record.techId);
  if (!account) return { ok: false, reason: invalidMsg };

  await store.updateTechPassword(account.id, await hashPassword(newPassword));
  await store.markResetTokenUsed(record.tokenHash, new Date().toISOString());
  return { ok: true };
}
