import { describe, it, expect } from "vitest";
import {
  SERVICES,
  describeSelection,
  findItem,
  itemKey,
  symptomKey,
} from "@/lib/services";
import { intakeSchema } from "@/lib/validation";

describe("service catalog", () => {
  it("is three levels deep everywhere", () => {
    expect(SERVICES.length).toBeGreaterThan(0);
    for (const cat of SERVICES) {
      expect(cat.items.length).toBeGreaterThan(0);
      for (const item of cat.items) {
        expect(item.symptoms.length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps item ids unique within a category", () => {
    for (const cat of SERVICES) {
      const ids = cat.items.map((i) => i.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("looks items up by category + id", () => {
    expect(findItem("plumbing", "faucet")?.label).toBe("Faucet");
    expect(findItem("plumbing", "nope")).toBeUndefined();
  });
});

describe("describeSelection", () => {
  it("falls back to the category when nothing deeper is picked", () => {
    expect(
      describeSelection({ categories: ["plumbing"], items: [], symptoms: [] }),
    ).toEqual(["Plumbing"]);
  });

  it("uses the item when no symptom is picked", () => {
    expect(
      describeSelection({
        categories: ["plumbing"],
        items: [itemKey("plumbing", "faucet")],
        symptoms: [],
      }),
    ).toEqual(["Faucet"]);
  });

  it("emits one entry per chosen symptom, most specific wins", () => {
    const out = describeSelection({
      categories: ["plumbing"],
      items: [itemKey("plumbing", "faucet")],
      symptoms: [
        symptomKey("plumbing", "faucet", "Drips when shut off"),
        symptomKey("plumbing", "faucet", "Leaks at the base"),
      ],
    });
    expect(out).toEqual([
      "Faucet — Drips when shut off",
      "Faucet — Leaks at the base",
    ]);
  });

  it("ignores selections under a category that isn't active", () => {
    expect(
      describeSelection({
        categories: [],
        items: [itemKey("plumbing", "faucet")],
        symptoms: [],
      }),
    ).toEqual([]);
  });

  it("produces entries the intake schema accepts, even fully expanded", () => {
    // Worst case: every category, every item, every symptom.
    const selection = {
      categories: SERVICES.map((c) => c.id),
      items: SERVICES.flatMap((c) => c.items.map((i) => itemKey(c.id, i.id))),
      symptoms: SERVICES.flatMap((c) =>
        c.items.flatMap((i) => i.symptoms.map((s) => symptomKey(c.id, i.id, s))),
      ),
    };
    const all = describeSelection(selection);
    // Every individual entry has to fit the per-entry length cap.
    for (const entry of all) expect(entry.length).toBeLessThanOrEqual(140);

    // A realistic selection (a few symptoms) has to pass validation whole.
    const realistic = describeSelection({
      categories: ["plumbing", "appliance"],
      items: [itemKey("plumbing", "faucet"), itemKey("appliance", "dishwasher")],
      symptoms: [
        symptomKey("plumbing", "faucet", "Drips when shut off"),
        symptomKey("appliance", "dishwasher", "Won't drain"),
      ],
    });
    const parsed = intakeSchema.safeParse({
      name: "Pat",
      email: "pat@e.com",
      phone: "5551239876",
      address: "500 Oak St, Springfield IL",
      affectedServices: realistic,
      room: "Kitchen",
      floor: "ground",
      description: "faucet drips and the dishwasher won't drain",
    });
    expect(parsed.success).toBe(true);
  });
});
