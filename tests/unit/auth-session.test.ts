import { describe, it, expect } from "vitest";
import {
  createSessionToken,
  verifySessionToken,
  readSessionSubject,
  safeEqual,
} from "@/lib/auth";

const SECRET = "test-secret-value";

describe("session tokens", () => {
  it("round-trips a valid token", async () => {
    const t = await createSessionToken(SECRET, "tech-123");
    expect(await verifySessionToken(SECRET, t)).toBe(true);
    expect(await readSessionSubject(SECRET, t)).toBe("tech-123");
  });

  it("rejects a token signed with a different secret", async () => {
    const t = await createSessionToken(SECRET, "tech-123");
    expect(await verifySessionToken("other-secret", t)).toBe(false);
    expect(await readSessionSubject("other-secret", t)).toBeNull();
  });

  it("rejects a tampered subject", async () => {
    const t = await createSessionToken(SECRET, "tech-123");
    const [payload, sig] = t.split(".");
    const tampered = `${payload}X.${sig}`;
    expect(await verifySessionToken(SECRET, tampered)).toBe(false);
  });

  it("rejects an expired token", async () => {
    const t = await createSessionToken(SECRET, "tech-123", -1000);
    expect(await verifySessionToken(SECRET, t)).toBe(false);
  });

  it("handles an empty subject", async () => {
    const t = await createSessionToken(SECRET);
    expect(await verifySessionToken(SECRET, t)).toBe(true);
    expect(await readSessionSubject(SECRET, t)).toBe("");
  });

  it("rejects undefined/garbage", async () => {
    expect(await verifySessionToken(SECRET, undefined)).toBe(false);
    expect(await verifySessionToken(SECRET, "not-a-token")).toBe(false);
  });
});

describe("safeEqual", () => {
  it("is true for equal strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
  });
  it("is false for different strings/lengths", () => {
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
