import { describe, it, expect, beforeAll, vi } from "vitest";
import {
  registerTech,
  loginTech,
  requestPasswordReset,
  resetPassword,
} from "@/lib/tech-auth";

// Trigger a reset and pull the raw token out of the console-transport email.
async function captureResetToken(email: string): Promise<string | null> {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await requestPasswordReset(email, "http://localhost");
    const logged = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    const m = logged.match(/tech\/reset\?token=([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  } finally {
    spy.mockRestore();
  }
}

// registerTech reads the invite code from TECH_PASSCODE.
beforeAll(() => {
  process.env.TECH_PASSCODE = "invite123";
});

const GOOD_PW = "Zebra-Muffin-River-7";

describe("registerTech", () => {
  it("requires the correct invite code", async () => {
    const bad = await registerTech({ inviteCode: "wrong", name: "A", email: "a@x.co", password: GOOD_PW });
    expect(bad.ok).toBe(false);
    expect(bad.field).toBe("inviteCode");
  });

  it("rejects a weak password", async () => {
    const weak = await registerTech({ inviteCode: "invite123", name: "A", email: "a@x.co", password: "short" });
    expect(weak.ok).toBe(false);
    expect(weak.field).toBe("password");
  });

  it("creates an account with a valid invite + password", async () => {
    const ok = await registerTech({ inviteCode: "invite123", name: "Alex", email: "Alex@Fix.co", password: GOOD_PW });
    expect(ok.ok).toBe(true);
    expect(ok.account?.email).toBe("alex@fix.co"); // normalized
    // Password is hashed, never stored in the clear.
    expect(ok.account?.passwordHash).not.toContain(GOOD_PW);
  });

  it("rejects a duplicate email", async () => {
    await registerTech({ inviteCode: "invite123", name: "Alex", email: "dup@fix.co", password: GOOD_PW });
    const dup = await registerTech({ inviteCode: "invite123", name: "Alex2", email: "dup@fix.co", password: GOOD_PW });
    expect(dup.ok).toBe(false);
    expect(dup.field).toBe("email");
  });
});

describe("loginTech", () => {
  it("accepts correct credentials and rejects wrong ones", async () => {
    await registerTech({ inviteCode: "invite123", name: "Alex", email: "login@fix.co", password: GOOD_PW });
    expect((await loginTech("login@fix.co", GOOD_PW)).ok).toBe(true);
    expect((await loginTech("login@fix.co", "nope")).ok).toBe(false);
    expect((await loginTech("missing@fix.co", GOOD_PW)).ok).toBe(false);
  });
});

describe("password reset (OWASP)", () => {
  const NEW_PW = "New-Otter-Canyon-9";

  it("resets via a single-use token and invalidates the old password", async () => {
    await registerTech({ inviteCode: "invite123", name: "Alex", email: "reset@fix.co", password: GOOD_PW });

    const token = await captureResetToken("reset@fix.co");
    expect(token).toBeTruthy();

    const ok = await resetPassword(token!, NEW_PW);
    expect(ok.ok).toBe(true);

    // New password works; old one no longer does.
    expect((await loginTech("reset@fix.co", NEW_PW)).ok).toBe(true);
    expect((await loginTech("reset@fix.co", GOOD_PW)).ok).toBe(false);

    // Token is single-use.
    const reuse = await resetPassword(token!, "Another-Pass-Word-1");
    expect(reuse.ok).toBe(false);
  });

  it("rejects an unknown token", async () => {
    const bad = await resetPassword("totally-unknown-token", NEW_PW);
    expect(bad.ok).toBe(false);
  });

  it("does not reveal whether an email exists (no throw for unknown)", async () => {
    await expect(
      requestPasswordReset("nobody@nowhere.co", "http://localhost"),
    ).resolves.toBeUndefined();
  });
});
