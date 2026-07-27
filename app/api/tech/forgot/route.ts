import { requestPasswordReset } from "@/lib/tech-auth";
import { forgotSchema } from "@/lib/validation";
import {
  rateLimit,
  clientIp,
  guardCsrf,
  noStoreJson,
} from "@/lib/security";

export const runtime = "nodejs";

// POST /api/tech/forgot — start a password reset. Always responds the same way
// whether or not the email is registered (no account-existence disclosure).
export async function POST(request: Request) {
  const csrf = guardCsrf(request);
  if (csrf) return csrf;

  const gate = rateLimit(`tech-forgot:${clientIp(request)}`, Date.now(), {
    max: 5,
    windowMs: 15 * 60 * 1000,
    baseBlockMs: 60 * 1000,
  });
  // Even when rate-limited, return the generic message (don't leak state).
  const generic = {
    ok: true,
    message: "If an account exists for that email, a reset link is on its way.",
  };
  if (!gate.allowed) return noStoreJson(generic);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noStoreJson(generic);
  }

  const parsed = forgotSchema.safeParse(body);
  if (parsed.success) {
    const origin =
      request.headers.get("origin") ||
      `${new URL(request.url).protocol}//${request.headers.get("host")}`;
    try {
      await requestPasswordReset(parsed.data.email, origin);
    } catch (err) {
      console.error("Password reset request failed:", err);
    }
  }
  return noStoreJson(generic);
}
