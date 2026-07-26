import { describe, it, expect } from "vitest";
import { getInitializedStore } from "@/lib/store";
import type {
  Submission,
  Assignment,
  TechnicianAccount,
  Charge,
} from "@/lib/types";

function submission(id: string, status: Submission["dispatchStatus"] = "queued"): Submission {
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
    summary: "test",
  };
  return {
    id,
    createdAt: new Date().toISOString(),
    input: {
      name: "Pat",
      email: "pat@e.com",
      phone: "5550001111",
      address: "1 Main St",
      affectedServices: [],
      description: "leaky faucet",
    },
    triage,
    heuristicTriage: triage,
    slotId: null,
    bookingStatus: "requested",
    location: null,
    dispatchStatus: status,
    assignment: null,
  };
}

const assignment = (techId: string): Assignment => ({
  techId,
  techName: "Alex",
  claimedAt: new Date().toISOString(),
  etaMinutes: null,
  etaCommittedAt: null,
  estimatedArrival: null,
});

describe("store — submissions & queue", () => {
  it("creates and lists queued jobs", async () => {
    const store = await getInitializedStore();
    await store.createSubmission(submission("s1"));
    await store.createSubmission(submission("s2"));
    const queue = await store.listQueueJobs();
    expect(queue.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
  });
});

describe("store — atomic claim", () => {
  it("lets only one technician claim a job", async () => {
    const store = await getInitializedStore();
    await store.createSubmission(submission("job"));
    const [a, b] = await Promise.all([
      store.claimJob("job", assignment("tech-A")),
      store.claimJob("job", assignment("tech-B")),
    ]);
    const winners = [a, b].filter(Boolean);
    expect(winners).toHaveLength(1);
    // Once assigned, it leaves the queue.
    expect(await store.listQueueJobs()).toHaveLength(0);
  });

  it("commitJobEta only for the assigned technician", async () => {
    const store = await getInitializedStore();
    await store.createSubmission(submission("job2"));
    await store.claimJob("job2", assignment("tech-A"));
    const wrong = await store.commitJobEta("job2", "tech-B", 60, new Date().toISOString(), new Date().toISOString());
    expect(wrong).toBeNull();
    const ok = await store.commitJobEta("job2", "tech-A", 60, new Date().toISOString(), new Date().toISOString());
    expect(ok?.dispatchStatus).toBe("en_route");
    expect(ok?.assignment?.etaMinutes).toBe(60);
  });
});

describe("store — charges", () => {
  it("creates and lists charges for a submission", async () => {
    const store = await getInitializedStore();
    const charge: Charge = {
      id: "c1",
      submissionId: "job",
      createdAt: new Date().toISOString(),
      createdByTechId: "tech-A",
      createdByTechName: "Alex",
      description: "labor",
      amountCents: 9900,
      currency: "usd",
      status: "pending",
      provider: "manual",
      providerRef: null,
    };
    await store.createCharge(charge);
    const list = await store.listChargesForSubmission("job");
    expect(list).toHaveLength(1);
    expect(list[0].amountCents).toBe(9900);
  });
});

describe("store — tech accounts & reset tokens", () => {
  const acct = (): TechnicianAccount => ({
    id: "t1",
    name: "Alex",
    email: "alex@fix.co",
    passwordHash: "scrypt$x",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  it("stores and looks up accounts by email and id", async () => {
    const store = await getInitializedStore();
    await store.createTechAccount(acct());
    expect((await store.getTechAccountByEmail("alex@fix.co"))?.id).toBe("t1");
    expect((await store.getTechAccountById("t1"))?.email).toBe("alex@fix.co");
    expect(await store.getTechAccountByEmail("nobody@x.com")).toBeNull();
  });

  it("keeps a single active reset token per tech", async () => {
    const store = await getInitializedStore();
    await store.createResetToken({ tokenHash: "h1", techId: "t1", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), usedAt: null });
    await store.createResetToken({ tokenHash: "h2", techId: "t1", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), usedAt: null });
    // The first token was invalidated when the second was created.
    expect((await store.getResetToken("h1"))?.usedAt).not.toBeNull();
    expect((await store.getResetToken("h2"))?.usedAt).toBeNull();
  });
});

describe("store — presence", () => {
  it("upserts presence by tech id", async () => {
    const store = await getInitializedStore();
    await store.upsertPresence({ techId: "t1", onDuty: true, location: { lat: 40, lng: -89 }, lastSeenAt: new Date().toISOString() });
    await store.upsertPresence({ techId: "t1", onDuty: false, location: null, lastSeenAt: new Date().toISOString() });
    const all = await store.listPresence();
    expect(all).toHaveLength(1);
    expect(all[0].onDuty).toBe(false);
  });
});
