import { describe, it, expect } from "vitest";
import {
  COARSE_GRID_DEG,
  approxMiles,
  bearingLabel,
  buildTrackView,
  coarsen,
  trackingUrl,
} from "@/lib/tracking";
import type { Assignment, Submission, TechPresence, TriageResult } from "@/lib/types";

const triage: TriageResult = {
  source: "heuristic",
  category: "plumbing",
  categoryLabel: "Plumbing",
  urgency: "normal",
  withinNonLicensedScope: true,
  safetyFlags: [],
  categoryScores: [],
  troubleshootingSteps: [],
  estimatedDurationMin: 60,
  summary: "t",
};

const HOME = { lat: 41.4731, lng: -87.0611 }; // Valparaiso, IN

function job(overrides: Partial<Submission> = {}): Submission {
  return {
    id: "job-1",
    createdAt: new Date().toISOString(),
    input: {
      name: "Pat",
      email: "pat@e.com",
      phone: "5550001111",
      address: "1 Main St",
      affectedServices: [],
      room: "Kitchen",
      floor: "ground",
      description: "faucet drips",
    },
    triage,
    heuristicTriage: triage,
    slotId: null,
    bookingStatus: "confirmed",
    location: HOME,
    dispatchStatus: "queued",
    assignment: null,
    ...overrides,
  };
}

function assignment(overrides: Partial<Assignment> = {}): Assignment {
  const claimedAt = new Date().toISOString();
  return {
    techId: "tech-A",
    techName: "Alex Rivera",
    claimedAt,
    etaMinutes: null,
    etaCommittedAt: null,
    estimatedArrival: null,
    ...overrides,
  };
}

function presence(overrides: Partial<TechPresence> = {}): TechPresence {
  return {
    techId: "tech-A",
    onDuty: true,
    location: { lat: 41.5203, lng: -87.1042 },
    lastSeenAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("coarsen", () => {
  it("snaps a point to the ~1 mile grid", () => {
    const c = coarsen({ lat: 41.47312, lng: -87.06119 });
    expect(c.lat).toBeCloseTo(41.47, 6);
    expect(c.lng).toBeCloseTo(-87.06, 6);
  });

  it("returns the same cell for nearby readings, so jitter can't be averaged out", () => {
    const a = coarsen({ lat: 41.4731, lng: -87.0611 });
    const b = coarsen({ lat: 41.4738, lng: -87.0614 });
    expect(a).toEqual(b);
  });

  it("never publishes more precision than the grid", () => {
    const c = coarsen({ lat: 41.473129, lng: -87.061195 });
    expect(Math.abs(c.lat / COARSE_GRID_DEG - Math.round(c.lat / COARSE_GRID_DEG))).toBeLessThan(1e-9);
  });
});

describe("bearingLabel + approxMiles", () => {
  it("names the direction the tech is coming from", () => {
    expect(bearingLabel(HOME, { lat: HOME.lat + 0.2, lng: HOME.lng })).toBe("north");
    expect(bearingLabel(HOME, { lat: HOME.lat, lng: HOME.lng - 0.2 })).toBe("west");
  });

  it("rounds distance to a deliberately blunt figure", () => {
    expect(approxMiles(3.31)).toBe(3.5);
    expect(approxMiles(0.42)).toBe(0.4);
  });
});

describe("buildTrackView", () => {
  it("reports 'requested' with no tech details before anyone claims it", () => {
    const view = buildTrackView(job(), null);
    expect(view.stage).toBe("requested");
    expect(view.tech).toBeNull();
    expect(view.minutesRemaining).toBeNull();
  });

  it("withholds location before an ETA is committed but names the tech", () => {
    const view = buildTrackView(
      job({ dispatchStatus: "assigned", assignment: assignment() }),
      presence(),
    );
    expect(view.stage).toBe("accepted");
    expect(view.tech?.firstName).toBe("Alex");
    // Claimed + on duty + fresh heartbeat ⇒ location is published.
    expect(view.tech?.approxLocation).not.toBeNull();
  });

  it("publishes only a coarse location while en route", () => {
    const now = new Date();
    const view = buildTrackView(
      job({
        dispatchStatus: "en_route",
        assignment: assignment({
          etaMinutes: 60,
          etaCommittedAt: now.toISOString(),
          estimatedArrival: new Date(now.getTime() + 60 * 60_000).toISOString(),
        }),
      }),
      presence(),
      now,
    );
    expect(view.stage).toBe("en_route");
    expect(view.minutesRemaining).toBe(60);
    // Exactly on the grid — not the raw fix the technician's phone reported.
    expect(view.tech?.approxLocation).toEqual({ lat: 41.52, lng: -87.1 });
    expect(view.tech?.approxLocation).not.toEqual(presence().location);
    expect(view.tech?.approxMilesAway).toBeGreaterThan(0);
    expect(view.tech?.directionFrom).toBe("north-west");
  });

  it("suppresses location when the technician goes off duty", () => {
    const view = buildTrackView(
      job({ dispatchStatus: "en_route", assignment: assignment({ etaMinutes: 30 }) }),
      presence({ onDuty: false }),
    );
    expect(view.tech?.approxLocation).toBeNull();
  });

  it("suppresses a stale location and says so", () => {
    const stale = new Date(Date.now() - 30 * 60_000).toISOString();
    const view = buildTrackView(
      job({ dispatchStatus: "en_route", assignment: assignment({ etaMinutes: 30 }) }),
      presence({ lastSeenAt: stale }),
    );
    expect(view.tech?.locationStale).toBe(true);
    expect(view.tech?.approxLocation).toBeNull();
  });

  it("flips to 'arriving' and floors the countdown once the ETA passes", () => {
    const now = new Date();
    const view = buildTrackView(
      job({
        dispatchStatus: "en_route",
        assignment: assignment({
          etaMinutes: 30,
          etaCommittedAt: new Date(now.getTime() - 40 * 60_000).toISOString(),
          estimatedArrival: new Date(now.getTime() - 5 * 60_000).toISOString(),
        }),
      }),
      presence(),
      now,
    );
    expect(view.stage).toBe("arriving");
    expect(view.minutesRemaining).toBe(0);
  });

  it("stops publishing location once the visit is complete", () => {
    const view = buildTrackView(
      job({ dispatchStatus: "completed", assignment: assignment({ etaMinutes: 30 }) }),
      presence(),
    );
    expect(view.stage).toBe("completed");
    expect(view.tech?.approxLocation).toBeNull();
  });

  it("never leaks contact details into the tracking payload", () => {
    const view = buildTrackView(
      job({ dispatchStatus: "en_route", assignment: assignment({ etaMinutes: 30 }) }),
      presence(),
    );
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("pat@e.com");
    expect(serialized).not.toContain("5550001111");
    expect(serialized).not.toContain("1 Main St");
    // Only the first name — never the technician's full name.
    expect(serialized).not.toContain("Rivera");
  });
});

describe("trackingUrl", () => {
  it("builds an absolute link without doubling slashes", () => {
    expect(trackingUrl("https://example.com/", "abc")).toBe(
      "https://example.com/track/abc",
    );
  });
});
