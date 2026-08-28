import { describe, it, expect } from "vitest";
import { getInitializedStore } from "@/lib/store";
import {
  getQueue,
  claimJob,
  commitEta,
  recordCharge,
  getTechAssignments,
} from "@/lib/dispatch";
import type { Submission } from "@/lib/types";

async function goOnDuty(techId: string) {
  const store = await getInitializedStore();
  await store.upsertPresence({
    techId,
    onDuty: true,
    location: null,
    lastSeenAt: new Date().toISOString(),
  });
}

async function seedJob(id: string, clientUrgency?: Submission["input"]["clientUrgency"]) {
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
  await store.createSubmission({
    id,
    createdAt: new Date().toISOString(),
    input: {
      name: "Pat",
      email: "pat@e.com",
      phone: "5550001111",
      address: "1 Main St",
      affectedServices: [],
      room: "Kitchen",
      floor: "ground",
      description: "leaky faucet",
      clientUrgency,
      smsOptIn: true,
    },
    triage,
    heuristicTriage: triage,
    slotId: null,
    bookingStatus: "requested",
    location: null,
    dispatchStatus: "queued",
    assignment: null,
  });
}

describe("dispatch service — full flow", () => {
  it("blocks claims from technicians who are off duty", async () => {
    await seedJob("j0");
    const blocked = await claimJob("j0", "tech-off", "Casey");
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toMatch(/on duty/i);
  });

  it("queues, claims (once), commits ETA, and bills", async () => {
    await seedJob("j1", "high");
    // Claiming requires being on duty (data dir is reset before each test).
    await goOnDuty("tech-A");
    await goOnDuty("tech-B");

    const queue = await getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].urgency).toBe("high");
    expect(queue[0].clientReported).toBe(true);
    // PII withheld pre-claim (address is present for routing; no name field).
    expect(queue[0]).not.toHaveProperty("name");

    const claim = await claimJob("j1", "tech-A", "Alex");
    expect(claim.ok).toBe(true);

    const second = await claimJob("j1", "tech-B", "Bailey");
    expect(second.ok).toBe(false); // already taken

    const eta = await commitEta("j1", "tech-A", 60);
    expect(eta.ok).toBe(true);
    expect(eta.job?.assignment?.etaMinutes).toBe(60);
    // Notification attempted (console transport → delivered:false, but no throw).
    expect(eta.notified).toBeDefined();

    const charge = await recordCharge({
      submissionId: "j1",
      techId: "tech-A",
      techName: "Alex",
      amountCents: 12500,
      description: "cartridge + labor",
    });
    expect(charge.ok).toBe(true);
    expect(charge.charge?.provider).toBe("manual");

    const mine = await getTechAssignments("tech-A");
    expect(mine).toHaveLength(1);
    expect(mine[0].id).toBe("j1");
  });

  it("rejects an invalid ETA increment", async () => {
    await seedJob("j2");
    await goOnDuty("tech-A");
    await claimJob("j2", "tech-A", "Alex");
    const bad = await commitEta("j2", "tech-A", 42);
    expect(bad.ok).toBe(false);
  });

  it("rejects a non-positive charge", async () => {
    await seedJob("j3");
    await goOnDuty("tech-A");
    await claimJob("j3", "tech-A", "Alex");
    const bad = await recordCharge({
      submissionId: "j3",
      techId: "tech-A",
      techName: "Alex",
      amountCents: 0,
      description: "nope",
    });
    expect(bad.ok).toBe(false);
  });
});
