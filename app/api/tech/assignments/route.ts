import { getTechAssignments } from "@/lib/dispatch";
import { getInitializedStore } from "@/lib/store";
import { getSessionTechId } from "@/lib/tech-session";
import { noStoreJson } from "@/lib/security";

export const runtime = "nodejs";

// GET /api/tech/assignments — the signed-in technician's active jobs (full
// contact details) plus any charges recorded against each, and the photos the
// customer attached at intake so the tech knows what they're walking into.
export async function GET() {
  const techId = await getSessionTechId();
  if (!techId) return noStoreJson({ error: "Not signed in." }, { status: 401 });

  try {
    const store = await getInitializedStore();
    const jobs = await getTechAssignments(techId);
    const withCharges = await Promise.all(
      jobs.map(async (job) => {
        const [charges, photos] = await Promise.all([
          store.listChargesForSubmission(job.id),
          job.photoCount
            ? store.listPhotosForSubmission(job.id)
            : Promise.resolve([]),
        ]);
        return { job, charges, photos };
      }),
    );
    return noStoreJson({ assignments: withCharges });
  } catch (err) {
    console.error("Assignments load failed:", err);
    return noStoreJson(
      { error: "Could not load your assignments." },
      { status: 500 },
    );
  }
}
