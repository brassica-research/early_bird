import { describe, it, expect, beforeAll } from "vitest";
import { POST as loginPOST } from "@/app/api/tech/login/route";
import { registerTech } from "@/lib/tech-auth";

beforeAll(() => {
  process.env.TECH_PASSCODE = "invite123";
});

const GOOD_PW = "Zebra-Muffin-River-7";

function loginReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/tech/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", host: "localhost", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/tech/login", () => {
  it("issues a session cookie for valid credentials", async () => {
    await registerTech({ inviteCode: "invite123", name: "Alex", email: "alex@fix.co", password: GOOD_PW });
    const res = await loginPOST(
      loginReq({ email: "alex@fix.co", password: GOOD_PW }, { "x-forwarded-for": "10.0.0.1" }),
    );
    expect(res.status).toBe(200);
    const setCookie =
      (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.().join(";") ??
      res.headers.get("set-cookie") ??
      "";
    expect(setCookie).toContain("eb_tech=");
  });

  it("rejects a wrong password with 401", async () => {
    await registerTech({ inviteCode: "invite123", name: "Alex", email: "alex2@fix.co", password: GOOD_PW });
    const res = await loginPOST(
      loginReq({ email: "alex2@fix.co", password: "wrong" }, { "x-forwarded-for": "10.0.0.2" }),
    );
    expect(res.status).toBe(401);
  });

  it("blocks a cross-origin request (CSRF) with 403", async () => {
    const res = await loginPOST(
      loginReq({ email: "alex@fix.co", password: GOOD_PW }, {
        origin: "https://evil.example",
        "x-forwarded-for": "10.0.0.3",
      }),
    );
    expect(res.status).toBe(403);
  });
});
