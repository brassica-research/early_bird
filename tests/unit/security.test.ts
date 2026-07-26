import { describe, it, expect } from "vitest";
import { rateLimit, rateLimitReset, isSameOrigin } from "@/lib/security";

describe("rateLimit", () => {
  const opts = { max: 3, windowMs: 60_000, baseBlockMs: 1000 };

  it("allows up to max then blocks with backoff", () => {
    const key = `k-${Math.random()}`;
    const now = 1_000_000;
    expect(rateLimit(key, now, opts).allowed).toBe(true);
    expect(rateLimit(key, now, opts).allowed).toBe(true);
    expect(rateLimit(key, now, opts).allowed).toBe(true);
    const blocked = rateLimit(key, now, opts);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("resets on success", () => {
    const key = `k-${Math.random()}`;
    const now = 2_000_000;
    rateLimit(key, now, opts);
    rateLimit(key, now, opts);
    rateLimitReset(key);
    expect(rateLimit(key, now, opts).allowed).toBe(true);
  });

  it("recovers after the window elapses", () => {
    const key = `k-${Math.random()}`;
    rateLimit(key, 0, opts);
    rateLimit(key, 0, opts);
    rateLimit(key, 0, opts);
    expect(rateLimit(key, 0, opts).allowed).toBe(false);
    // Far in the future → window reset.
    expect(rateLimit(key, 10_000_000, opts).allowed).toBe(true);
  });
});

describe("isSameOrigin", () => {
  const req = (headers: Record<string, string>) =>
    new Request("http://localhost/api/x", { headers });

  it("allows matching origin", () => {
    expect(isSameOrigin(req({ host: "localhost", origin: "http://localhost" }))).toBe(true);
  });

  it("blocks a foreign origin", () => {
    expect(isSameOrigin(req({ host: "localhost", origin: "https://evil.example" }))).toBe(false);
  });

  it("allows requests with no browser origin (native/curl)", () => {
    expect(isSameOrigin(req({ host: "localhost" }))).toBe(true);
  });
});
