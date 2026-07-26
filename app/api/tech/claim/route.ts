import { claimJob } from "@/lib/dispatch";
import { claimSchema } from "@/lib/validation";
import { getSessionTech } from "@/lib/tech-session";
import { guardCsrf, noStoreJson } from "@/lib/security";

export const runtime = "nodejs";

// POST /api/tech/claim — atomically claim a queued job for the signed-in
// technician. Returns 409 if another technician won the race.
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

  const parsed = claimSchema.safeParse(body);
  if (!parsed.success) {
    return noStoreJson({ error: "Validation failed" }, { status: 400 });
  }

  const result = await claimJob(parsed.data.submissionId, tech.id, tech.name);
  if (!result.ok) {
    return noStoreJson({ error: result.reason }, { status: 409 });
  }
  return noStoreJson({ job: result.job });
}
