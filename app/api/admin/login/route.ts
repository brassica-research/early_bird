import {
  ADMIN_COOKIE,
  getAdminPassword,
  getAdminSecret,
  createSessionToken,
  safeEqual,
} from "@/lib/auth";
import {
  rateLimit,
  rateLimitReset,
  clientIp,
  guardCsrf,
  noStoreJson,
} from "@/lib/security";

export const runtime = "nodejs";

// POST /api/admin/login — exchange the shared admin password for a signed
// session cookie. Rate-limited, same-origin, and cached-never.
export async function POST(request: Request) {
  const csrf = guardCsrf(request);
  if (csrf) return csrf;

  const password = getAdminPassword();
  const secret = getAdminSecret();
  if (!password || !secret) {
    return noStoreJson(
      { error: "Admin is not configured. Set ADMIN_PASSWORD." },
      { status: 503 },
    );
  }

  const gate = rateLimit(`admin-login:${clientIp(request)}`, Date.now(), {
    max: 5,
    windowMs: 15 * 60 * 1000,
    baseBlockMs: 30 * 1000,
  });
  if (!gate.allowed) {
    return noStoreJson(
      { error: `Too many attempts. Try again in ${gate.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } },
    );
  }

  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return noStoreJson({ error: "Invalid request." }, { status: 400 });
  }

  const provided = typeof body.password === "string" ? body.password : "";
  if (!provided || !safeEqual(provided, password)) {
    return noStoreJson({ error: "Incorrect password." }, { status: 401 });
  }

  rateLimitReset(`admin-login:${clientIp(request)}`);
  const token = await createSessionToken(secret);
  const res = noStoreJson({ ok: true });
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 8 * 60 * 60,
  });
  return res;
}
