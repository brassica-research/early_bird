import { describe, it, expect } from "vitest";
import { runHeuristic } from "@/lib/triage/heuristic";
import { effectiveUrgency, URGENCY_RANK } from "@/lib/types";
import seed from "@/data/heuristic-config.seed.json";
import type { HeuristicConfig } from "@/lib/store/types";
import type { IntakeInput } from "@/lib/types";

const config = seed as unknown as HeuristicConfig;

function input(overrides: Partial<IntakeInput>): IntakeInput {
  return {
    name: "T",
    email: "t@e.com",
    phone: "5550000000",
    address: "1 Main St",
    affectedServices: [],
    description: "",
    ...overrides,
  };
}

describe("heuristic triage — classification", () => {
  it("classifies a plumbing leak", () => {
    const r = runHeuristic(input({ description: "kitchen faucet has a bad leak and clogged drain" }), config);
    expect(r.category).toBe("plumbing");
    expect(r.categoryScores[0].category).toBe("plumbing");
  });

  it("classifies electrical", () => {
    const r = runHeuristic(input({ description: "dead outlet and a flickering light fixture" }), config);
    expect(r.category).toBe("electrical");
  });

  it("classifies connectivity", () => {
    const r = runHeuristic(input({ description: "wifi dead zone, router is old" }), config);
    expect(r.category).toBe("connectivity");
  });

  it("falls back to 'other' when nothing matches", () => {
    const r = runHeuristic(input({ description: "the sky is blue today" }), config);
    expect(r.category).toBe("other");
  });

  it("uses affectedServices chips as signal", () => {
    const r = runHeuristic(
      input({ description: "it is broken", affectedServices: ["Refrigerator"] }),
      config,
    );
    expect(r.category).toBe("appliance");
  });
});

describe("heuristic triage — urgency + scope", () => {
  it("escalates emergencies", () => {
    const r = runHeuristic(input({ description: "burst pipe is flooding the kitchen" }), config);
    expect(r.urgency).toBe("emergency");
  });

  it("flags out-of-scope safety terms (gas)", () => {
    const r = runHeuristic(input({ description: "I smell gas near the furnace" }), config);
    expect(r.withinNonLicensedScope).toBe(false);
    expect(r.safetyFlags.length).toBeGreaterThan(0);
  });

  it("keeps ordinary jobs in scope", () => {
    const r = runHeuristic(input({ description: "leaky faucet drip" }), config);
    expect(r.withinNonLicensedScope).toBe(true);
  });
});

describe("effectiveUrgency", () => {
  it("prefers client-reported urgency over triage", () => {
    const triage = runHeuristic(input({ description: "leaky faucet" }), config);
    const u = effectiveUrgency({ input: input({ description: "leaky faucet", clientUrgency: "emergency" }), triage });
    expect(u).toBe("emergency");
  });

  it("falls back to triage urgency when client didn't specify", () => {
    const triage = runHeuristic(input({ description: "burst pipe flooding" }), config);
    const u = effectiveUrgency({ input: input({ description: "burst pipe flooding" }), triage });
    expect(u).toBe(triage.urgency);
  });

  it("ranks urgencies correctly", () => {
    expect(URGENCY_RANK.emergency).toBeGreaterThan(URGENCY_RANK.high);
    expect(URGENCY_RANK.high).toBeGreaterThan(URGENCY_RANK.normal);
    expect(URGENCY_RANK.normal).toBeGreaterThan(URGENCY_RANK.low);
  });
});
