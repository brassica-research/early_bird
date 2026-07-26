import { getQueue } from "@/lib/dispatch";
import { noStoreJson } from "@/lib/security";

export const runtime = "nodejs";

// GET /api/tech/queue — jobs awaiting a technician (contact PII withheld until
// claimed). The client sorts by recency / urgency / proximity.
export async function GET() {
  try {
    const queue = await getQueue();
    return noStoreJson({ queue });
  } catch (err) {
    console.error("Queue load failed:", err);
    return noStoreJson({ error: "Could not load the queue." }, { status: 500 });
  }
}
