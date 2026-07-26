import { randomUUID } from "crypto";
import { getInitializedStore } from "@/lib/store";
import { getSessionTechId } from "@/lib/tech-session";
import { heartbeatSchema } from "@/lib/validation";
import { guardCsrf, noStoreJson } from "@/lib/security";

export const runtime = "nodejs";

// POST /api/tech/heartbeat — the technician app periodically reports on-duty
// status and (if permitted) current location, so dispatch sees live presence.
export async function POST(request: Request) {
  const csrf = guardCsrf(request);
  if (csrf) return csrf;

  const techId = await getSessionTechId();
  if (!techId) return noStoreJson({ error: "Not signed in." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noStoreJson({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = heartbeatSchema.safeParse(body);
  if (!parsed.success) {
    return noStoreJson({ error: "Validation failed" }, { status: 400 });
  }

  const { onDuty, lat, lng } = parsed.data;
  const now = new Date().toISOString();
  const store = await getInitializedStore();
  await store.upsertPresence({
    techId,
    onDuty,
    location: lat != null && lng != null ? { lat, lng } : null,
    lastSeenAt: now,
  });

  // Record duty history: open a session on clock-in (idempotent), close it on
  // clock-out.
  if (onDuty) {
    await store.openDutySession({
      id: randomUUID(),
      techId,
      clockInAt: now,
      clockOutAt: null,
    });
  } else {
    await store.closeOpenDutySession(techId, now);
  }

  return noStoreJson({ ok: true });
}
