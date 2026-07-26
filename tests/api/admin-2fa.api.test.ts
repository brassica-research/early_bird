import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { POST as adminLogin } from "@/app/api/admin/login/route";
import { generateTotpSecret, totpAt } from "@/lib/auth/totp";

const SECRET = generateTotpSecret();

beforeAll(() => {
  process.env.ADMIN_PASSWORD = "hunter2";
  process.env.ADMIN_SESSION_SECRET = "test-admin-secret";
  process.env.ADMIN_TOTP_SECRET = SECRET;
});
afterAll(() => {
  delete process.env.ADMIN_TOTP_SECRET;
});

function req(body: unknown, ip: string): Request {
  return new Request("http://localhost/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", host: "localhost", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

describe("admin login with 2FA enabled", () => {
  it("rejects when the code is missing", async () => {
    const res = await adminLogin(req({ password: "hunter2" }, "20.0.0.1"));
    expect(res.status).toBe(401);
    expect((await res.json()).need2fa).toBe(true);
  });

  it("rejects an incorrect code", async () => {
    const res = await adminLogin(req({ password: "hunter2", token: "000000" }, "20.0.0.2"));
    expect(res.status).toBe(401);
  });

  it("still rejects a wrong password even with a valid code", async () => {
    const res = await adminLogin(
      req({ password: "wrong", token: totpAt(SECRET, Date.now()) }, "20.0.0.3"),
    );
    expect(res.status).toBe(401);
  });

  it("accepts the correct password + valid code", async () => {
    const res = await adminLogin(
      req({ password: "hunter2", token: totpAt(SECRET, Date.now()) }, "20.0.0.4"),
    );
    expect(res.status).toBe(200);
    const setCookie =
      (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.().join(";") ??
      res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("eb_admin=");
  });
});
