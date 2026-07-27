import { setupTech2fa } from "@/lib/tech-auth";
import { getSessionTechId } from "@/lib/tech-session";
import { guardCsrf, noStoreJson } from "@/lib/security";

export const runtime = "nodejs";

// POST /api/tech/2fa/setup — mint a pending TOTP secret + otpauth URL for the
// signed-in technician (not active until a code is verified via /enable).
export async function POST(request: Request) {
  const csrf = guardCsrf(request);
  if (csrf) return csrf;

  const techId = await getSessionTechId();
  if (!techId) return noStoreJson({ error: "Not signed in." }, { status: 401 });

  const result = await setupTech2fa(techId);
  if (!result.ok) return noStoreJson({ error: result.reason }, { status: 400 });
  return noStoreJson({ secret: result.secret, otpauthUrl: result.otpauthUrl });
}
