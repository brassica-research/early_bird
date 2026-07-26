import { describe, it, expect } from "vitest";
import {
  generateTotpSecret,
  totpAt,
  verifyTotp,
  otpauthUrl,
  base32Encode,
  base32Decode,
} from "@/lib/auth/totp";

describe("base32", () => {
  it("round-trips arbitrary bytes", () => {
    const buf = Buffer.from([0, 1, 2, 250, 255, 128, 64]);
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
  });
});

describe("TOTP (RFC 6238)", () => {
  it("generates a usable base32 secret", () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]+$/);
    expect(s.length).toBeGreaterThan(16);
  });

  it("verifies a freshly generated code", () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const code = totpAt(secret, now);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotp(secret, code, 1, now)).toBe(true);
  });

  it("accepts codes within the ±1 step skew window", () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const prev = totpAt(secret, now - 30_000);
    const next = totpAt(secret, now + 30_000);
    expect(verifyTotp(secret, prev, 1, now)).toBe(true);
    expect(verifyTotp(secret, next, 1, now)).toBe(true);
  });

  it("rejects codes outside the window", () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const far = totpAt(secret, now - 5 * 60_000);
    expect(verifyTotp(secret, far, 1, now)).toBe(false);
  });

  it("rejects malformed input", () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, "12345", 1)).toBe(false);
    expect(verifyTotp(secret, "abcdef", 1)).toBe(false);
    expect(verifyTotp(secret, "", 1)).toBe(false);
  });

  it("matches a known RFC-style vector (SHA1 secret 'GEZDGNBV...')", () => {
    // Secret = base32("12345678901234567890"); RFC 6238 T=59s → code 94287082.
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totpAt(secret, 59_000)).toBe("287082".padStart(6, "0"));
  });

  it("builds an otpauth URL", () => {
    const url = otpauthUrl("ABCDEF234567", "ops@earlybird.co");
    expect(url.startsWith("otpauth://totp/")).toBe(true);
    expect(url).toContain("secret=ABCDEF234567");
    expect(url).toContain("issuer=Early+Bird");
  });
});
