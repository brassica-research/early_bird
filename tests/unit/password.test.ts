import { describe, it, expect } from "vitest";
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
