import { getInitializedStore } from "@/lib/store";
import { noStoreJson } from "@/lib/security";

export const runtime = "nodejs";

// Retain/return up to 5 years of duty history.
const HISTORY_YEARS = 5;

// GET /api/admin/technician?id=... — one technician's profile plus historical
// duty sessions (clock in/out) and every job they've worked, with details.
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return noStoreJson({ error: "id is required." }, { status: 400 });

  try {
    const store = await getInitializedStore();
    const account = await store.getTechAccountById(id);
    if (!account) {
      return noStoreJson({ error: "Technician not found." }, { status: 404 });
    }

    const since = new Date();
    since.setFullYear(since.getFullYear() - HISTORY_YEARS);

    const [dutySessions, presence, jobs] = await Promise.all([
      store.listDutySessions(id, since.toISOString()),
      store.listPresence(),
      store.listAllTechJobs(id),
    ]);

    const p = presence.find((x) => x.techId === id) ?? null;

    return noStoreJson({
      technician: {
        id: account.id,
        name: account.name,
        email: account.email,
        phone: account.phone ?? null,
        twoFactorEnabled: Boolean(account.totpEnabled),
        createdAt: account.createdAt,
        onDuty: Boolean(p?.onDuty),
        lastSeenAt: p?.lastSeenAt ?? null,
      },
      dutySessions,
      jobs,
    });
  } catch (err) {
    console.error("Technician history load failed:", err);
    return noStoreJson({ error: "Could not load history." }, { status: 500 });
  }
}
