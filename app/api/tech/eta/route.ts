import { commitEta } from "@/lib/dispatch";
import { etaSchema } from "@/lib/validation";
import { getSessionTech } from "@/lib/tech-session";
import { guardCsrf, noStoreJson } from "@/lib/security";

export const runtime = "nodejs";

// POST /api/tech/eta — commit a 30-minute-increment ETA on a claimed job and
// notify the customer that a technician has been assigned.
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

  const parsed = etaSchema.safeParse(body);
  if (!parsed.success) {
    return noStoreJson({ error: "Validation failed" }, { status: 400 });
  }

  const result = await commitEta(
    parsed.data.submissionId,
    tech.id,
    parsed.data.etaMinutes,
  );
  if (!result.ok) {
    return noStoreJson({ error: result.reason }, { status: 409 });
  }
  return noStoreJson({ job: result.job, notified: result.notified });
}
