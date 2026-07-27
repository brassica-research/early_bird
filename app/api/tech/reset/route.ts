import { resetPassword } from "@/lib/tech-auth";
import { resetSchema } from "@/lib/validation";
import {
  rateLimit,
  clientIp,
  guardCsrf,
  noStoreJson,
} from "@/lib/security";

export const runtime = "nodejs";

// POST /api/tech/reset — set a new password using a valid reset token.
export async function POST(request: Request) {
  const csrf = guardCsrf(request);
  if (csrf) return csrf;

  const gate = rateLimit(`tech-reset:${clientIp(request)}`, Date.now(), {
    max: 10,
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

  const parsed = resetSchema.safeParse(body);
  if (!parsed.success) {
    return noStoreJson({ error: "Enter a new password." }, { status: 400 });
  }

  const result = await resetPassword(parsed.data.token, parsed.data.password);
  if (!result.ok) {
    return noStoreJson({ error: result.reason }, { status: 400 });
  }
  return noStoreJson({ ok: true });
}
