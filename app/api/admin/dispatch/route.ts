import { getInitializedStore } from "@/lib/store";
import { getTechAssignments } from "@/lib/dispatch";
import { noStoreJson } from "@/lib/security";
import type { TechPresence } from "@/lib/types";

export const runtime = "nodejs";

// A technician counts as "live" if on duty and seen within this window.
const LIVE_WINDOW_MS = 2 * 60 * 1000;

// GET /api/admin/dispatch — the owner's operational picture: all queued jobs,
// every technician with on-duty status + last-known location, and each
// technician's current assignments.
export async function GET() {
  try {
    const store = await getInitializedStore();
    const [queue, accounts, presence] = await Promise.all([
      store.listQueueJobs(),
      store.listTechAccounts(),
      store.listPresence(),
    ]);

    const presenceById = new Map<string, TechPresence>(
      presence.map((p) => [p.techId, p]),
    );
    const now = Date.now();

    const technicians = await Promise.all(
      accounts.map(async (acc) => {
        const p = presenceById.get(acc.id) ?? null;
        const live = Boolean(
          p &&
            p.onDuty &&
            now - new Date(p.lastSeenAt).getTime() < LIVE_WINDOW_MS,
        );
        const assignments = await getTechAssignments(acc.id);
        return {
          id: acc.id,
          name: acc.name,
          email: acc.email,
          phone: acc.phone ?? null,
          onDuty: Boolean(p?.onDuty),
          live,
          location: p?.location ?? null,
          lastSeenAt: p?.lastSeenAt ?? null,
          assignments,
        };
      }),
    );

    const stats = {
      queued: queue.length,
      technicians: technicians.length,
      onDuty: technicians.filter((t) => t.live).length,
      assigned: technicians.reduce((n, t) => n + t.assignments.length, 0),
    };

    return noStoreJson({ queue, technicians, stats });
  } catch (err) {
    console.error("Admin dispatch load failed:", err);
    return noStoreJson(
      { error: "Could not load dispatch." },
      { status: 500 },
    );
  }
}
