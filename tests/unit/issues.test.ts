import { describe, it, expect } from "vitest";
import { ISSUES_DATA } from "@/lib/issues-matrix-data";
import { assessIssue, matchIssues } from "@/lib/issues";

describe("issues dataset", () => {
  it("loads 200 issues with valid scopes", () => {
    expect(ISSUES_DATA).toHaveLength(200);
    const scopes = new Set(["in_scope", "partial", "grey", "out_of_scope", "emergency"]);
    for (const i of ISSUES_DATA) expect(scopes.has(i.scope)).toBe(true);
  });
});

describe("assessIssue — safety hard stops surface", () => {
  const hard: [string, RegExp][] = [
    ["my microwave stopped heating", /microwave/i],
    ["garage door spring broke", /garage door spring/i],
  ];
  for (const [text, re] of hard) {
    it(`flags hard stop: ${text}`, () => {
      const a = assessIssue(text);
      expect(a).not.toBeNull();
      expect(a!.hardStop).toBe(true);
      expect(a!.requiresLicensedPro).toBe(true);
      expect(a!.issue.issue).toMatch(re);
    });
  }
});

describe("assessIssue — licensed work is flagged out of scope", () => {
  const licensed = ["Light fixture", "Dead outlet", "Leaky faucet", "Water heater", "Not cooling, low on refrigerant"];
  for (const t of licensed) {
    it(`out_of_scope: ${t}`, () => {
      const a = assessIssue(t);
      expect(a).not.toBeNull();
      expect(a!.scope).toBe("out_of_scope");
      expect(a!.requiresLicensedPro).toBe(true);
    });
  }
});

describe("assessIssue — fixable work is in scope", () => {
  const ok = ["Clogged toilet", "GFCI / breaker reset", "Air filter", "dryer vent cleaning", "smoke detector chirping"];
  for (const t of ok) {
    it(`in_scope: ${t}`, () => {
      const a = assessIssue(t);
      expect(a).not.toBeNull();
      expect(a!.scope).toBe("in_scope");
      expect(a!.requiresLicensedPro).toBe(false);
    });
  }
});

describe("assessIssue — grey zone", () => {
  it("running toilet is grey", () => {
    expect(assessIssue("Running toilet")!.scope).toBe("grey");
  });
});

describe("assessIssue — no confident match returns null", () => {
  it("returns null for gibberish", () => {
    expect(assessIssue("xyzzy qwerty asdf")).toBeNull();
    expect(assessIssue("")).toBeNull();
  });
});

describe("matchIssues ranking", () => {
  it("ranks the exact issue first", () => {
    const m = matchIssues("clogged toilet won't drain");
    expect(m[0].issue.issue).toMatch(/clogged toilet/i);
  });
});
