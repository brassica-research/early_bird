import { describe, it, expect, beforeAll } from "vitest";
import {
  registerTech,
  loginTech,
  setupTech2fa,
  enableTech2fa,
  disableTech2fa,
} from "@/lib/tech-auth";
import { totpAt } from "@/lib/auth/totp";

beforeAll(() => {
  process.env.TECH_PASSCODE = "invite123";
});

const PW = "Zebra-Muffin-River-7";

async function newTech(email: string) {
  const r = await registerTech({ inviteCode: "invite123", name: "Alex", email, password: PW });
  return r.account!;
}

describe("technician 2FA enrollment + enforcement", () => {
  it("enrolls, then requires a code at login", async () => {
    const acct = await newTech("2fa@fix.co");

    // Setup mints a secret but doesn't enable yet.
    const setup = await setupTech2fa(acct.id);
    expect(setup.ok).toBe(true);
    expect(setup.secret).toBeTruthy();

    // Login still works with just the password until 2FA is enabled.
    expect((await loginTech("2fa@fix.co", PW)).ok).toBe(true);

    // A wrong code fails to enable; the right code enables.
    expect((await enableTech2fa(acct.id, "000000")).ok).toBe(false);
    const code = totpAt(setup.secret!, Date.now());
    expect((await enableTech2fa(acct.id, code)).ok).toBe(true);

    // Now login requires a valid second factor.
    const noCode = await loginTech("2fa@fix.co", PW);
    expect(noCode.ok).toBe(false);
    expect(noCode.need2fa).toBe(true);

    const badCode = await loginTech("2fa@fix.co", PW, "000000");
    expect(badCode.ok).toBe(false);

    const good = await loginTech("2fa@fix.co", PW, totpAt(setup.secret!, Date.now()));
    expect(good.ok).toBe(true);
  });

  it("disables 2FA with a valid code and restores password-only login", async () => {
    const acct = await newTech("2fa2@fix.co");
    const setup = await setupTech2fa(acct.id);
    await enableTech2fa(acct.id, totpAt(setup.secret!, Date.now()));

    expect((await disableTech2fa(acct.id, "000000")).ok).toBe(false);
    expect((await disableTech2fa(acct.id, totpAt(setup.secret!, Date.now()))).ok).toBe(true);

    // Password alone works again.
    expect((await loginTech("2fa2@fix.co", PW)).ok).toBe(true);
  });
});
