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

describe("assessIssue — drill-down phrasing and stray-keyword defense", () => {
  // The symptom chips phrase problems as verbs while the catalog uses gerunds.
  it("matches a drill-down selection to the catalog issue", () => {
    const a = assessIssue(
      "Faucet — Drips when shut off Faucet — Leaks at the base Master bathroom",
    );
    expect(a).not.toBeNull();
    expect(a!.issue.issue).toMatch(/dripping faucet/i);
  });

  it("treats verb and gerund phrasing the same", () => {
    expect(assessIssue("the faucet drips")!.issue.issue).toMatch(
      /dripping faucet/i,
    );
    expect(assessIssue("dripping faucet")!.issue.issue).toMatch(
      /dripping faucet/i,
    );
    // "clogs" reads as "clogged", so a verb-phrased drain complaint lands on a
    // drain issue. (Two common words on their own — "the drain clogs" — stay
    // below the bar by design; the catalog has a dozen kinds of clogged drain.)
    expect(assessIssue("the kitchen sink drain clogs up")!.issue.issue).toMatch(
      /drain/i,
    );
  });

  // A single rare word used to clear the bar on its own, because token weight
  // is 1/document-frequency: "drips all night" matched "Camera night vision
  // poor or IR glare" on the strength of "night" alone.
  it("does not match on one stray rare word", () => {
    const a = assessIssue(
      "The bathroom faucet drips all night and water pools around the base.",
    );
    expect(a).not.toBeNull();
    expect(a!.issue.issue).not.toMatch(/night vision/i);
    expect(a!.issue.issue).toMatch(/faucet/i);

    // "vision" alone shouldn't drag in the camera issue either.
    expect(assessIssue("I need better vision in the hallway")).toBeNull();
  });

  it("still flags a safety hard-stop from a single strong keyword", () => {
    const a = assessIssue("the microwave stopped heating");
    expect(a!.hardStop).toBe(true);
  });
});
