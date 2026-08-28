import { saveJobReport } from "@/lib/dispatch";
import { jobReportSchema } from "@/lib/validation";
import { getSessionTech } from "@/lib/tech-session";
import { guardCsrf, noStoreJson } from "@/lib/security";

export const runtime = "nodejs";

// POST /api/tech/report — save the technician's close-out report (resolved?,
// issue summary/progress, and vendor-handoff details) on a claimed job.
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

  const parsed = jobReportSchema.safeParse(body);
  if (!parsed.success) {
    return noStoreJson({ error: "Validation failed" }, { status: 400 });
  }

  const { submissionId, resolved, progress, vendorHandoff } = parsed.data;
  const result = await saveJobReport(submissionId, tech.id, {
    resolved,
    progress,
    vendorHandoff,
  });
  if (!result.ok) {
    return noStoreJson({ error: result.reason }, { status: 409 });
  }
  return noStoreJson({ job: result.job });
}
