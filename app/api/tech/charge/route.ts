import { recordCharge } from "@/lib/dispatch";
import { chargeSchema } from "@/lib/validation";
import { getSessionTech } from "@/lib/tech-session";
import { guardCsrf, noStoreJson } from "@/lib/security";

export const runtime = "nodejs";

// POST /api/tech/charge — record a charge against a job through the configured
// payment provider (manual ledger by default; Stripe once connected).
export async function POST(request: Request) {
  const csrf = guardCsrf(request);
  if (csrf) return csrf;

  const tech = await getSessionTech();
  if (!tech) return noStoreJson({ error: "Not signed in." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noStoreJson({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = chargeSchema.safeParse(body);
  if (!parsed.success) {
    return noStoreJson(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const result = await recordCharge({
    submissionId: parsed.data.submissionId,
    techId: tech.id,
    techName: tech.name,
    amountCents: parsed.data.amountCents,
    description: parsed.data.description,
  });
  if (!result.ok) {
    return noStoreJson({ error: result.reason }, { status: 400 });
  }
  return noStoreJson({ charge: result.charge });
}
