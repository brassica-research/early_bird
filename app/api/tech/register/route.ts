import { TECH_COOKIE, getTechSecret, createSessionToken } from "@/lib/auth";
import { registerTech } from "@/lib/tech-auth";
import { techRegisterSchema } from "@/lib/validation";
import {
  rateLimit,
  clientIp,
  guardCsrf,
  noStoreJson,
} from "@/lib/security";

export const runtime = "nodejs";

// POST /api/tech/register — create a technician account (gated by the invite
// code) and sign the new technician in.
export async function POST(request: Request) {
  const csrf = guardCsrf(request);
  if (csrf) return csrf;

  const secret = getTechSecret();
  if (!secret) {
    return noStoreJson(
      { error: "Technician sign-up is not configured." },
      { status: 503 },
    );
  }

  const gate = rateLimit(`tech-register:${clientIp(request)}`, Date.now(), {
    max: 6,
    windowMs: 30 * 60 * 1000,
    baseBlockMs: 60 * 1000,
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

  const parsed = techRegisterSchema.safeParse(body);
  if (!parsed.success) {
    return noStoreJson(
      { error: "Please complete all fields.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await registerTech(parsed.data);
    if (!result.ok || !result.account) {
      return noStoreJson(
        { error: result.reason, field: result.field },
        { status: 400 },
      );
    }

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
  } catch (err) {
    console.error("tech register failed:", err);
    return noStoreJson(
      { error: "Something went wrong creating your account. Please try again." },
      { status: 500 },
    );
  }
}
