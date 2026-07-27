import { getSessionTech } from "@/lib/tech-session";
import { noStoreJson } from "@/lib/security";

export const runtime = "nodejs";

// GET /api/tech/me — the signed-in technician's identity (from the session).
export async function GET() {
  const tech = await getSessionTech();
  if (!tech) {
    return noStoreJson({ error: "Not signed in." }, { status: 401 });
  }
  return noStoreJson({
    tech: {
      id: tech.id,
      name: tech.name,
      email: tech.email,
      twoFactorEnabled: Boolean(tech.totpEnabled),
    },
  });
}
