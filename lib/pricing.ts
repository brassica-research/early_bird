// ---------------------------------------------------------------------------
// Visit-fee pricing.
//
// The flat fee that covers the trip + the on-site diagnostic. It depends only
// on WHEN the visit window starts:
//
//   8:00am – 3:59pm  → $99   (standard daytime)
//   4:00pm – 8:59pm  → $135  (evening premium)
//
// Parts and labor beyond the diagnostic are quoted on-site by the technician
// and billed separately (see lib/dispatch recordCharge).
//
// TIME BASIS — a booked window is priced by the LOCAL clock hour it starts at,
// in the timezone the schedule is published in (see lib/scheduling/availability
// and data/slots.seed.json: slots are generated with setHours in the server's
// local timezone, so reading the hour back on the server round-trips exactly).
// That is deliberately the ONLY place the fee is computed: the browser renders
// whatever price the API attached to a slot, and /api/checkout recomputes it
// from the stored slot, so a client in another timezone can never change what
// is charged.
//
// A window that starts before the tier boundary is priced at that tier for its
// whole length — the 2pm–5pm window is a $99 daytime visit even though it runs
// past 4pm, because the customer is quoted on arrival time, not on the tail.
// ---------------------------------------------------------------------------

import type { Slot } from "./types";

export type FeeTier = "day" | "evening";

/** First hour of the standard daytime tier (inclusive). */
export const DAY_START_HOUR = 8;
/** First hour of the evening tier (inclusive) — also the end of daytime. */
export const EVENING_START_HOUR = 16;
/** Last hour a visit can start (inclusive) before the evening tier closes. */
export const EVENING_END_HOUR = 21;

export const DAY_FEE_CENTS = 9_900;
export const EVENING_FEE_CENTS = 13_500;

export interface VisitFeeQuote {
  tier: FeeTier;
  amountCents: number;
  /** Short label for the tier, e.g. "Evening visit". */
  label: string;
  /** The hours the tier covers, e.g. "4:00pm–9:00pm". */
  windowLabel: string;
  /** One-line customer-facing explanation. */
  note: string;
}

const DAY_QUOTE: Omit<VisitFeeQuote, "amountCents"> = {
  tier: "day",
  label: "Daytime visit",
  windowLabel: "8:00am–4:00pm",
  note: "Standard visit fee for a window starting between 8:00am and 4:00pm.",
};

const EVENING_QUOTE: Omit<VisitFeeQuote, "amountCents"> = {
  tier: "evening",
  label: "Evening visit",
  windowLabel: "4:00pm–9:00pm",
  note: "Evening rate applies to windows starting between 4:00pm and 9:00pm.",
};

/**
 * Fee for a visit starting at the given local clock hour (0–23). Hours outside
 * published service times fall back to the daytime rate — we never invent a
 * premium for a window we shouldn't have offered in the first place.
 */
export function visitFeeForHour(hour: number): VisitFeeQuote {
  const h = Math.floor(hour);
  if (h >= EVENING_START_HOUR && h < EVENING_END_HOUR) {
    return { ...EVENING_QUOTE, amountCents: EVENING_FEE_CENTS };
  }
  return { ...DAY_QUOTE, amountCents: DAY_FEE_CENTS };
}

/**
 * Fee for a concrete slot. Server-side only — it reads the hour in the
 * process's local timezone, which is the timezone the slot was generated in.
 */
export function visitFeeForSlot(slot: Pick<Slot, "start">): VisitFeeQuote {
  return visitFeeForHour(new Date(slot.start).getHours());
}

/** A slot with its price attached, as returned to the booking UI. */
export type PricedSlot = Slot & { fee: VisitFeeQuote };

/** Attach the visit fee to each slot before sending availability to a client. */
export function priceSlots(slots: Slot[]): PricedSlot[] {
  return slots.map((s) => ({ ...s, fee: visitFeeForSlot(s) }));
}

/** Format cents as US currency, e.g. 9900 → "$99". */
export function formatMoney(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars)
    ? `$${dollars.toFixed(0)}`
    : `$${dollars.toFixed(2)}`;
}
