import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { checkPasswordPolicy } from "@/lib/auth/passwordPolicy";

describe("password hashing (scrypt)", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("Zebra-Muffin-River-7");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("Zebra-Muffin-River-7", hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("produces a unique hash per call (random salt)", async () => {
    const a = await hashPassword("same-password-123");
    const b = await hashPassword("same-password-123");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password-123", a)).toBe(true);
    expect(await verifyPassword("same-password-123", b)).toBe(true);
  });

  it("returns false for a malformed stored hash", async () => {
    expect(await verifyPassword("x", "not-a-valid-hash")).toBe(false);
  });
});

describe("password policy (NIST 800-63B length-first)", () => {
  it("rejects short passwords", () => {
    expect(checkPasswordPolicy("short").ok).toBe(false);
  });
  it("rejects common passwords", () => {
    expect(checkPasswordPolicy("password").ok).toBe(false);
    expect(checkPasswordPolicy("12345678").ok).toBe(false);
  });
  it("accepts a long passphrase without composition rules", () => {
    expect(checkPasswordPolicy("correct horse battery staple").ok).toBe(true);
  });
  it("rejects an over-long password", () => {
    expect(checkPasswordPolicy("a".repeat(200)).ok).toBe(false);
  });
});

describe("password policy — relaxed mode (AUTH_PASSWORD_POLICY=relaxed)", () => {
  const prev = process.env.AUTH_PASSWORD_POLICY;
  beforeAll(() => {
    process.env.AUTH_PASSWORD_POLICY = "relaxed";
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.AUTH_PASSWORD_POLICY;
    else process.env.AUTH_PASSWORD_POLICY = prev;
  });
  it("accepts short, common passwords for easy test-account creation", () => {
    expect(checkPasswordPolicy("test").ok).toBe(true);
    expect(checkPasswordPolicy("password").ok).toBe(true);
  });
  it("still enforces a minimal length floor and the max length", () => {
    expect(checkPasswordPolicy("ab").ok).toBe(false);
    expect(checkPasswordPolicy("a".repeat(200)).ok).toBe(false);
  });
});
