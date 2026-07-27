import { describe, it, expect } from "vitest";
import { detectSafety } from "@/lib/safety";

describe("detectSafety — triggers on emergency terms", () => {
  const cases: [string, string][] = [
    ["I think I smell gas in the kitchen", "gas"],
    ["there's a strong gas odor near the furnace", "gas"],
    ["the outlet is sparking when I plug in", "electrical"],
    ["the panel is arcing and buzzing", "electrical"],
    ["smoke is coming from the dryer", "fire"],
    ["the stove is on fire", "fire"],
    ["I got a bad shock touching the switch", "electrical"],
    ["there is a noxious odor from the vents", "air"],
    ["I smell carbon monoxide", "air"],
  ];

  it.each(cases)("flags %j → %s", (text, code) => {
    const d = detectSafety(text);
    expect(d.triggered).toBe(true);
    expect(d.codes).toContain(code);
  });

  it("is case-insensitive", () => {
    expect(detectSafety("SMELL GAS NOW").triggered).toBe(true);
    expect(detectSafety("Sparking Outlet").triggered).toBe(true);
  });

  it("matches multi-word phrases", () => {
    expect(detectSafety("smell of gas").codes).toContain("gas");
  });
});

describe("detectSafety — avoids obvious false positives", () => {
  it("does not trigger on ordinary requests", () => {
    expect(detectSafety("the kitchen faucet has a slow drip").triggered).toBe(false);
    expect(detectSafety("wifi dead zone in the back bedroom").triggered).toBe(false);
  });

  it("respects word boundaries (fireplace ≠ fire)", () => {
    expect(detectSafety("please service my gas fireplace insert").codes).not.toContain("fire");
  });

  it("returns an empty detection for empty text", () => {
    const d = detectSafety("");
    expect(d.triggered).toBe(false);
    expect(d.matched).toHaveLength(0);
  });
});
