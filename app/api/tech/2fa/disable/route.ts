import { disableTech2fa } from "@/lib/tech-auth";
import { getSessionTechId } from "@/lib/tech-session";
import { totpTokenSchema } from "@/lib/validation";
import { guardCsrf, noStoreJson } from "@/lib/security";

export const runtime = "nodejs";

// POST /api/tech/2fa/disable — turn off two-factor (requires a current code).
export async function POST(request: Request) {
  const csrf = guardCsrf(request);
  if (csrf) return csrf;

  const techId = await getSessionTechId();
  if (!techId) return noStoreJson({ error: "Not signed in." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noStoreJson({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = totpTokenSchema.safeParse(body);
  if (!parsed.success) {
    return noStoreJson({ error: "Enter the 6-digit code." }, { status: 400 });
  }

  const result = await disableTech2fa(techId, parsed.data.token);
  if (!result.ok) return noStoreJson({ error: result.reason }, { status: 400 });
  return noStoreJson({ ok: true });
}
