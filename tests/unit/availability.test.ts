import { describe, it, expect } from "vitest";
import { _internal } from "@/lib/scheduling/availability";

const { generateSlots, slotId } = _internal;

const seed = {
  daysAhead: 3,
  servedWeekdays: [1, 2, 3, 4, 5, 6], // Mon–Sat
  windows: [
    { label: "Morning (8am–11am)", startHour: 8, endHour: 11, capacity: 2 },
    { label: "Evening (5pm–8pm)", startHour: 17, endHour: 20, capacity: 1 },
  ],
};

describe("generateSlots", () => {
  it("spans only the configured horizon and skips excluded weekdays", () => {
    // A Monday at 6am → today+next 2 days, minus Sunday.
    const from = new Date("2026-07-20T06:00:00"); // Monday
    const slots = generateSlots(seed, from);
    const days = [...new Set(slots.map((s) => s.start.slice(0, 10)))].sort();
    // Mon 7-20, Tue 7-21, Wed 7-22 (all served)
    expect(days).toEqual(["2026-07-20", "2026-07-21", "2026-07-22"]);
    expect(slots.every((s) => s.capacity >= 1 && s.booked === 0)).toBe(true);
  });

  it("skips windows that already started today", () => {
    const from = new Date("2026-07-20T12:00:00"); // Monday noon
    const slots = generateSlots(seed, from);
    const today = slots.filter((s) => s.start.slice(0, 10) === "2026-07-20");
    // Morning (8am) already passed; only Evening remains today.
    expect(today).toHaveLength(1);
    expect(today[0].windowLabel).toContain("Evening");
  });

  it("excludes Sunday from a horizon that would include it", () => {
    const from = new Date("2026-07-18T06:00:00"); // Saturday
    const slots = generateSlots(seed, from);
    const days = [...new Set(slots.map((s) => s.start.slice(0, 10)))].sort();
    // Sat 7-18, (Sun 7-19 excluded), Mon 7-20
    expect(days).toEqual(["2026-07-18", "2026-07-20"]);
  });

  it("produces deterministic ids", () => {
    expect(slotId("2026-07-20", "Morning (8am–11am)")).toBe(
      slotId("2026-07-20", "Morning (8am–11am)"),
    );
  });
});
