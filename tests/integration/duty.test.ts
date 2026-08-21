import { describe, it, expect } from "vitest";
import { getInitializedStore } from "@/lib/store";
import type { DutySession, Submission, Assignment } from "@/lib/types";

const session = (techId: string, inAt: string, outAt: string | null): DutySession => ({
  id: `${techId}-${inAt}`,
  techId,
  clockInAt: inAt,
  clockOutAt: outAt,
});

describe("duty sessions", () => {
  it("opens at most one session per tech and closes it", async () => {
    const store = await getInitializedStore();
    const a = await store.openDutySession(session("t1", "2026-01-01T09:00:00Z", null));
    // Opening again while one is open returns the existing open session.
    const b = await store.openDutySession(session("t1", "2026-01-01T10:00:00Z", null));
    expect(b.id).toBe(a.id);

    const closed = await store.closeOpenDutySession("t1", "2026-01-01T17:00:00Z");
    expect(closed?.clockOutAt).toBe("2026-01-01T17:00:00Z");

    // After closing, a new open session can start.
    const c = await store.openDutySession(session("t1", "2026-01-02T09:00:00Z", null));
    expect(c.id).not.toBe(a.id);
  });

  it("lists sessions filtered by since, newest first", async () => {
    const store = await getInitializedStore();
    await store.openDutySession(session("t2", "2021-01-01T09:00:00Z", null));
    await store.closeOpenDutySession("t2", "2021-01-01T12:00:00Z");
    await store.openDutySession(session("t2", "2026-06-01T09:00:00Z", null));

    const all = await store.listDutySessions("t2");
    expect(all.length).toBe(2);
    expect(all[0].clockInAt > all[1].clockInAt).toBe(true); // newest first

    const recent = await store.listDutySessions("t2", "2025-01-01T00:00:00Z");
    expect(recent.length).toBe(1);
  });
});

describe("listAllTechJobs", () => {
  it("returns every job assigned to a tech, any status", async () => {
    const store = await getInitializedStore();
    const triage = {
      source: "heuristic" as const,
      category: "plumbing" as const,
      categoryLabel: "Plumbing",
      urgency: "normal" as const,
      withinNonLicensedScope: true,
      safetyFlags: [],
      categoryScores: [],
      troubleshootingSteps: [],
      estimatedDurationMin: 60,
      summary: "t",
    };
    const assignment = (techId: string): Assignment => ({
      techId,
      techName: "Alex",
      claimedAt: new Date().toISOString(),
      etaMinutes: 60,
      etaCommittedAt: new Date().toISOString(),
      estimatedArrival: new Date().toISOString(),
    });
    const mk = (id: string, status: Submission["dispatchStatus"], techId: string | null): Submission => ({
      id,
      createdAt: new Date().toISOString(),
      input: { name: "P", email: "p@e.com", phone: "5550000000", address: "1 St", affectedServices: [], room: "Garage", floor: "ground", description: "x" },
      triage,
      heuristicTriage: triage,
      slotId: null,
      bookingStatus: "requested",
      location: null,
      dispatchStatus: status,
      assignment: techId ? assignment(techId) : null,
    });

    await store.createSubmission(mk("j1", "en_route", "tech-A"));
    await store.createSubmission(mk("j2", "completed", "tech-A"));
    await store.createSubmission(mk("j3", "queued", null));
    await store.createSubmission(mk("j4", "assigned", "tech-B"));

    const mine = await store.listAllTechJobs("tech-A");
    expect(mine.map((j) => j.id).sort()).toEqual(["j1", "j2"]);
  });
});
