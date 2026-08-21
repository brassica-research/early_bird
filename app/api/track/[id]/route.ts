import { getInitializedStore } from "@/lib/store";
import { buildTrackView } from "@/lib/tracking";
import { clientIp, noStoreJson, rateLimit } from "@/lib/security";

export const runtime = "nodejs";

// GET /api/track/:id — the customer-facing "Where's my tech?" feed.
//
// Authorization is the submission id itself: an unguessable v4 UUID handed to
// the customer at booking and emailed to them, the same capability-link model
// as a parcel tracking number. It is rate-limited so the id space can't be
// swept, and it returns strictly the tracking view — no contact details, no
// pricing, and only a COARSE technician location (see lib/tracking).
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const limited = rateLimit(`track:${clientIp(request)}`, Date.now(), {
    max: 120,
    windowMs: 60_000,
    baseBlockMs: 30_000,
  });
  if (!limited.allowed) {
    return noStoreJson(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } },
    );
  }

  const store = await getInitializedStore();
  const job = await store.getSubmission(id);
  if (!job) {
    return noStoreJson({ error: "We couldn't find that visit." }, { status: 404 });
  }

  // Presence for the claiming technician only — never the whole roster.
  let presence = null;
  if (job.assignment) {
    const all = await store.listPresence();
    presence = all.find((p) => p.techId === job.assignment!.techId) ?? null;
  }

  return noStoreJson({ track: buildTrackView(job, presence) });
}
