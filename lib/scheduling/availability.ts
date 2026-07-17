import { promises as fs } from "fs";
import path from "path";
import { getInitializedStore } from "@/lib/store";
import type { Slot } from "@/lib/types";

// ---------------------------------------------------------------------------
// Availability engine.
//
// Expands the window templates in data/slots.seed.json into concrete, dated,
// capacity-bearing slots for the next N days, and persists them via the store.
// Booking goes through store.reserveSlot(), which is atomic in both drivers,
// so a slot can never be booked beyond its capacity (no double-booking).
// ---------------------------------------------------------------------------

interface SlotSeed {
  daysAhead: number;
  servedWeekdays: number[]; // 0=Sun .. 6=Sat
  windows: Array<{
    label: string;
    startHour: number;
    endHour: number;
    capacity: number;
  }>;
}

const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");

async function loadSeed(): Promise<SlotSeed> {
  const raw = await fs.readFile(
    path.join(DATA_DIR, "slots.seed.json"),
    "utf8",
  );
  return JSON.parse(raw) as SlotSeed;
}

/** Deterministic id for a (date, window) pair so regeneration is idempotent. */
function slotId(dateKey: string, label: string): string {
  return `slot_${dateKey}_${label.replace(/[^a-z0-9]+/gi, "").toLowerCase()}`;
}

/** Build the concrete slot list for the horizon from the seed. */
export function generateSlots(seed: SlotSeed, from: Date): Slot[] {
  const slots: Slot[] = [];
  for (let day = 0; day < seed.daysAhead; day++) {
    const date = new Date(from);
    date.setDate(date.getDate() + day);
    if (!seed.servedWeekdays.includes(date.getDay())) continue;

    const dateKey = date.toISOString().slice(0, 10); // YYYY-MM-DD
    for (const w of seed.windows) {
      const start = new Date(date);
      start.setHours(w.startHour, 0, 0, 0);
      const end = new Date(date);
      end.setHours(w.endHour, 0, 0, 0);

      // Skip windows that have already started today.
      if (start.getTime() <= from.getTime()) continue;

      slots.push({
        id: slotId(dateKey, w.label),
        start: start.toISOString(),
        end: end.toISOString(),
        windowLabel: w.label,
        capacity: w.capacity,
        booked: 0,
      });
    }
  }
  return slots;
}

/**
 * Ensure the store has a current slot schedule for the (short) horizon defined
 * in the seed. Because the horizon is only a couple of days, the schedule has
 * to roll forward as time passes — so this regenerates whenever the freshly
 * computed horizon contains a slot the store doesn't have yet (e.g. a new day),
 * or when `force` is passed. Regeneration preserves existing bookings by
 * carrying over each surviving slot's `booked` count (matched by its stable,
 * date-based id), and naturally drops past days.
 */
export async function ensureSchedule(force = false): Promise<Slot[]> {
  const store = await getInitializedStore();
  const hasSlots = await store.hasSlots();

  const seed = await loadSeed();
  const fresh = generateSlots(seed, new Date());

  // Carry over booking counts for any slot that already exists in the store,
  // so rolling the schedule forward never resurrects a booked slot as open.
  let needsWrite = force || !hasSlots;
  for (const s of fresh) {
    const existing = await store.getSlot(s.id);
    if (existing) {
      if (existing.booked > 0) s.booked = Math.min(existing.booked, s.capacity);
    } else {
      // A slot in the current horizon is missing → schedule has drifted.
      needsWrite = true;
    }
  }

  if (!needsWrite) {
    return store.listOpenSlots();
  }

  await store.replaceSlots(fresh);
  return store.listOpenSlots();
}

export async function listAvailability(): Promise<Slot[]> {
  await ensureSchedule(false);
  const store = await getInitializedStore();
  return store.listOpenSlots();
}

export interface BookingResult {
  ok: boolean;
  slot?: Slot;
  reason?: string;
}

/** Atomically reserve capacity on a slot. */
export async function bookSlot(slotId: string): Promise<BookingResult> {
  const store = await getInitializedStore();
  const slot = await store.reserveSlot(slotId);
  if (!slot) {
    return { ok: false, reason: "Slot is full or no longer available." };
  }
  return { ok: true, slot };
}

// Exported for potential admin use / tests.
export const _internal = { generateSlots, slotId };
