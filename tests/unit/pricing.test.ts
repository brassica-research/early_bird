import { describe, it, expect } from "vitest";
import {
  DAY_FEE_CENTS,
  EVENING_FEE_CENTS,
  formatMoney,
  priceSlots,
  visitFeeForHour,
  visitFeeForSlot,
} from "@/lib/pricing";
import type { Slot } from "@/lib/types";

/** A slot starting at the given local hour today. */
function slotAt(hour: number, id = "s1"): Slot {
  const start = new Date();
  start.setHours(hour, 0, 0, 0);
  const end = new Date(start);
  end.setHours(hour + 3, 0, 0, 0);
  return {
    id,
    start: start.toISOString(),
    end: end.toISOString(),
    windowLabel: `Window ${hour}`,
    capacity: 2,
    booked: 0,
  };
}

describe("visit fee tiers", () => {
  it("charges the daytime rate from 8am up to (not including) 4pm", () => {
    for (const hour of [8, 9, 11, 13, 14, 15]) {
      const fee = visitFeeForHour(hour);
      expect(fee.tier).toBe("day");
      expect(fee.amountCents).toBe(DAY_FEE_CENTS);
      expect(fee.amountCents).toBe(9900);
    }
  });

  it("charges the evening rate from 4pm through 9pm", () => {
    for (const hour of [16, 17, 19, 20]) {
      const fee = visitFeeForHour(hour);
      expect(fee.tier).toBe("evening");
      expect(fee.amountCents).toBe(EVENING_FEE_CENTS);
      expect(fee.amountCents).toBe(13500);
    }
  });

  it("switches tier exactly at 4pm", () => {
    expect(visitFeeForHour(15).tier).toBe("day");
    expect(visitFeeForHour(16).tier).toBe("evening");
  });

  it("prices a window by its START, so 2pm–5pm stays a daytime visit", () => {
    expect(visitFeeForSlot(slotAt(14)).amountCents).toBe(DAY_FEE_CENTS);
  });

  it("falls back to the daytime rate outside published service hours", () => {
    expect(visitFeeForHour(6).tier).toBe("day");
    expect(visitFeeForHour(22).tier).toBe("day");
  });

  it("attaches a fee to every slot in an availability list", () => {
    const priced = priceSlots([slotAt(8, "a"), slotAt(17, "b")]);
    expect(priced.map((s) => s.fee.amountCents)).toEqual([
      DAY_FEE_CENTS,
      EVENING_FEE_CENTS,
    ]);
    // The slot's own fields survive untouched.
    expect(priced[0].id).toBe("a");
    expect(priced[1].capacity).toBe(2);
  });
});

describe("formatMoney", () => {
  it("drops cents for whole dollars and keeps them otherwise", () => {
    expect(formatMoney(9900)).toBe("$99");
    expect(formatMoney(13500)).toBe("$135");
    expect(formatMoney(12345)).toBe("$123.45");
  });
});
