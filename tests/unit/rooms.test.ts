import { describe, it, expect } from "vitest";
import {
  suggestRooms,
  ROOM_SUGGESTIONS,
  WHOLE_HOME,
} from "@/lib/rooms";

describe("suggestRooms — issue-aware room filtering", () => {
  it("offers every room when nothing is selected", () => {
    expect(suggestRooms([])).toEqual(ROOM_SUGGESTIONS);
  });

  it("narrows a toilet to bathrooms + basement, excluding kitchen/attic", () => {
    const rooms = suggestRooms(["plumbing:toilet"]);
    expect(rooms).toContain("Master bathroom");
    expect(rooms).toContain("Hall bathroom");
    expect(rooms).toContain("Basement");
    expect(rooms).not.toContain("Kitchen");
    expect(rooms).not.toContain("Attic");
    expect(rooms).not.toContain("Master bedroom");
    // Whole home stays available as a catch-all.
    expect(rooms).toContain(WHOLE_HOME);
  });

  it("keeps a garbage disposal in the kitchen only", () => {
    const rooms = suggestRooms(["plumbing:disposal"]);
    expect(rooms).toContain("Kitchen");
    expect(rooms).not.toContain("Master bathroom");
    expect(rooms).not.toContain("Attic");
  });

  it("puts the breaker panel in the basement/garage", () => {
    const rooms = suggestRooms(["electrical:breaker"]);
    expect(rooms).toContain("Basement");
    expect(rooms).toContain("Garage");
    expect(rooms).not.toContain("Kitchen");
    expect(rooms).not.toContain("Master bedroom");
  });

  it("unions rooms across multiple constrained issues", () => {
    const rooms = suggestRooms(["plumbing:toilet", "appliance:dishwasher"]);
    expect(rooms).toContain("Master bathroom"); // from toilet
    expect(rooms).toContain("Kitchen"); // from dishwasher
  });

  it("falls back to all rooms when an unconstrained issue is present", () => {
    // An outlet can be anywhere, so we don't hide rooms even alongside a toilet.
    const rooms = suggestRooms(["plumbing:toilet", "electrical:outlet"]);
    expect(rooms).toEqual(ROOM_SUGGESTIONS);
  });

  it("falls back to all rooms for an issue we don't map", () => {
    expect(suggestRooms(["repair:drywall"])).toEqual(ROOM_SUGGESTIONS);
  });
});
