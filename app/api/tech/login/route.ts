import { TECH_COOKIE, getTechSecret, createSessionToken } from "@/lib/auth";
import { loginTech } from "@/lib/tech-auth";
import { techLoginSchema } from "@/lib/validation";
import {
  rateLimit,
  rateLimitReset,
  clientIp,
  guardCsrf,
  noStoreJson,
} from "@/lib/security";

export const runtime = "nodejs";

// POST /api/tech/login — email + password → session cookie bound to the tech id.
export async function POST(request: Request) {
  const csrf = guardCsrf(request);
  if (csrf) return csrf;

  const secret = getTechSecret();
  if (!secret) {
    return noStoreJson(
      { error: "Technician access is not configured. Set TECH_PASSCODE." },
      { status: 503 },
    );
  }

  const gate = rateLimit(`tech-login:${clientIp(request)}`, Date.now(), {
    max: 8,
    windowMs: 15 * 60 * 1000,
    baseBlockMs: 30 * 1000,
  });
  if (!gate.allowed) {
    return noStoreJson(
      { error: `Too many attempts. Try again in ${gate.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noStoreJson({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = techLoginSchema.safeParse(body);
  if (!parsed.success) {
    return noStoreJson({ error: "Enter your email and password." }, { status: 400 });
  }

  const result = await loginTech(
    parsed.data.email,
    parsed.data.password,
    parsed.data.token,
  );
  if (!result.ok || !result.account) {
    return noStoreJson(
      { error: result.reason, need2fa: result.need2fa },
      { status: 401 },
    );
  }

  rateLimitReset(`tech-login:${clientIp(request)}`);
  const token = await createSessionToken(secret, result.account.id);
  const res = noStoreJson({
    ok: true,
    tech: { id: result.account.id, name: result.account.name },
  });
  res.cookies.set(TECH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 8 * 60 * 60,
  });
  return res;
}
