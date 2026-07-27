import { describe, it, expect } from "vitest";
import { haversineKm, kmToMiles } from "@/lib/geo/geocode";

describe("haversineKm", () => {
  it("is ~0 for identical points", () => {
    expect(haversineKm({ lat: 40, lng: -89 }, { lat: 40, lng: -89 })).toBeCloseTo(0, 5);
  });

  it("approximates a known distance (Springfield IL ↔ Chicago ~ 300km)", () => {
    const d = haversineKm({ lat: 39.8, lng: -89.65 }, { lat: 41.88, lng: -87.63 });
    expect(d).toBeGreaterThan(260);
    expect(d).toBeLessThan(320);
  });

  it("kmToMiles converts", () => {
    expect(kmToMiles(1)).toBeCloseTo(0.621371, 4);
  });
});
