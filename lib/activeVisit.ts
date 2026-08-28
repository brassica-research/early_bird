// ---------------------------------------------------------------------------
// Active-visit memory (client-only).
//
// When a customer books, we remember their submission id in localStorage so
// they can always get back to the "Where's my tech?" tracker — even if they
// navigate away or close the tab. The site header surfaces a link whenever a
// visit is remembered; the tracker clears it once the visit is finished.
//
// The id in the URL is already the customer's capability (same model as a
// parcel-tracking link), so storing it locally on their own device carries no
// additional exposure. Every access is guarded for SSR and private-mode
// storage failures.
// ---------------------------------------------------------------------------

const KEY = "eb.activeVisit";
/** Stop offering a stale link after a day. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Fired on the window when the active visit changes, so the header updates. */
export const ACTIVE_VISIT_EVENT = "eb:active-visit";

interface StoredVisit {
  id: string;
  savedAt: number;
}

export function setActiveVisit(id: string): void {
  if (typeof window === "undefined" || !id) return;
  try {
    const payload: StoredVisit = { id, savedAt: Date.now() };
    window.localStorage.setItem(KEY, JSON.stringify(payload));
    window.dispatchEvent(new Event(ACTIVE_VISIT_EVENT));
  } catch {
    /* storage unavailable (private mode, quota) — non-fatal */
  }
}

export function getActiveVisit(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredVisit>;
    if (!parsed?.id || typeof parsed.savedAt !== "number") return null;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
      clearActiveVisit();
      return null;
    }
    return parsed.id;
  } catch {
    return null;
  }
}

export function clearActiveVisit(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
    window.dispatchEvent(new Event(ACTIVE_VISIT_EVENT));
  } catch {
    /* non-fatal */
  }
}
