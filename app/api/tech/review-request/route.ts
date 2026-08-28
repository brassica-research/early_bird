import { requestReview } from "@/lib/dispatch";
import { reviewRequestSchema } from "@/lib/validation";
import { getSessionTech } from "@/lib/tech-session";
import { guardCsrf, noStoreJson } from "@/lib/security";

export const runtime = "nodejs";

// POST /api/tech/review-request — technician manually sends the customer a
// review request (email always; SMS if they opted in).
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

  const parsed = reviewRequestSchema.safeParse(body);
  if (!parsed.success) {
    return noStoreJson({ error: "Validation failed" }, { status: 400 });
  }

  const result = await requestReview(parsed.data.submissionId, tech.id);
  if (!result.ok) {
    return noStoreJson({ error: result.reason }, { status: 409 });
  }
  return noStoreJson({ job: result.job, notified: result.notified });
}
