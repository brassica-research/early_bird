import { describe, it, expect } from "vitest";
import {
  STATES,
  findState,
  parseStateFromAddress,
  categoryToTrade,
  assessLicensing,
} from "@/lib/licensing";

describe("licensing dataset", () => {
  it("covers all 50 states, sorted by name", () => {
    expect(STATES).toHaveLength(50);
    const names = STATES.map((s) => s.name);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });

  it("looks up states by code or name", () => {
    expect(findState("AZ")?.name).toBe("Arizona");
    expect(findState("arizona")?.code).toBe("AZ");
    expect(findState("Nowhere")).toBeNull();
    expect(findState("")).toBeNull();
  });
});

describe("categoryToTrade", () => {
  it("maps the three regulated trades and nothing else", () => {
    expect(categoryToTrade("plumbing")).toBe("plumbing");
    expect(categoryToTrade("electrical")).toBe("electrical");
    expect(categoryToTrade("hvac")).toBe("hvac");
    for (const light of ["appliance", "repair", "connectivity", "other"]) {
      expect(categoryToTrade(light)).toBeNull();
    }
  });
});

describe("parseStateFromAddress", () => {
  it("extracts a trailing USPS code", () => {
    expect(parseStateFromAddress("123 Main St, Dallas, TX 75001")).toBe("TX");
  });
  it("extracts a full state name", () => {
    expect(parseStateFromAddress("500 Ocean Ave, Miami, Florida")).toBe("FL");
  });
  it("returns null when nothing is recognizable", () => {
    expect(parseStateFromAddress("123 Main St")).toBeNull();
    expect(parseStateFromAddress("")).toBeNull();
  });
});

describe("assessLicensing", () => {
  it("flags a restrictive state as needing a licensed pro (no exemption)", () => {
    const a = assessLicensing("FL", ["electrical"]);
    expect(a).not.toBeNull();
    expect(a!.requiresLicensedPro).toBe(true);
    expect(a!.trades[0].requiresLicensedPro).toBe(true);
    expect(a!.trades[0].message).toMatch(/licensed electrician/i);
  });

  it("surfaces a per-trade minor-repair carve-out when the source cell has one", () => {
    // North Carolina's plumbing cell carries a "minor repair/replacement exempt"
    // note; its electrical cell explicitly has no exemption.
    const nc = assessLicensing("NC", ["plumbing", "electrical"]);
    const plumbing = nc!.trades.find((t) => t.trade === "plumbing")!;
    const electrical = nc!.trades.find((t) => t.trade === "electrical")!;
    expect(plumbing.requiresLicensedPro).toBe(true);
    expect(plumbing.message).toMatch(/carve-out|minor/i);
    expect(electrical.requiresLicensedPro).toBe(true);
    expect(electrical.message).not.toMatch(/carve-out/i);
  });

  it("surfaces the general unlicensed dollar cap for a state-licensed trade", () => {
    // Arizona's trade carve-out lives in its $1,000 general cap (prose), not the
    // per-trade cell — the message should cite the cap rather than deny it.
    const az = assessLicensing("AZ", ["plumbing"]);
    expect(az!.trades[0].requiresLicensedPro).toBe(true);
    expect(az!.trades[0].message).toMatch(/\$1,000|unlicensed cap/i);
  });

  it("treats light-burden categories as no state-trade gate", () => {
    const a = assessLicensing("FL", ["appliance", "connectivity", "repair"]);
    expect(a!.trades).toHaveLength(0);
    expect(a!.requiresLicensedPro).toBe(false);
  });

  it("collapses duplicate trades and preserves order", () => {
    const a = assessLicensing("TX", ["plumbing", "plumbing", "hvac"]);
    expect(a!.trades.map((t) => t.trade)).toEqual(["plumbing", "hvac"]);
  });

  it("returns null for an unknown state", () => {
    expect(assessLicensing("ZZ", ["plumbing"])).toBeNull();
  });

  it("carries state metadata for operator routing", () => {
    const a = assessLicensing("Oregon", ["hvac"]);
    expect(a!.stateCode).toBe("OR");
    expect(a!.implication).toBe("restrictive");
    expect(typeof a!.writtenContract).toBe("string");
    expect(typeof a!.notes).toBe("string");
  });
});
