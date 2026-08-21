import { randomUUID } from "crypto";
import { getInitializedStore } from "@/lib/store";
import {
  effectiveUrgency,
  type Submission,
  type ServiceCategoryId,
  type Urgency,
  type GeoPoint,
  type Assignment,
  type Charge,
} from "@/lib/types";
import { sendEmail } from "@/lib/notify/email";
import { sendSms } from "@/lib/notify/sms";
import {
  technicianAssignedEmail,
  technicianAssignedSms,
} from "@/lib/notify/templates";
import { getPaymentProvider, DEFAULT_CURRENCY } from "@/lib/payments";
import { trackingUrl } from "@/lib/tracking";

// ---------------------------------------------------------------------------
// Technician dispatch orchestration: the shared queue, atomic claiming,
// committed ETAs (which notify the customer), and job billing.
// ---------------------------------------------------------------------------

/** ETA choices, in 30-minute increments. */
export const ETA_OPTIONS_MIN = [30, 60, 90, 120, 150, 180, 240];

/** Queue item shown to technicians BEFORE claiming (contact PII withheld). */
export interface QueueItem {
  id: string;
  createdAt: string;
  category: ServiceCategoryId;
  categoryLabel: string;
  urgency: Urgency;
  /** True when the urgency came from the customer (vs. triage-derived). */
  clientReported: boolean;
  withinNonLicensedScope: boolean;
  estimatedDurationMin: number;
  description: string;
  /** Unrelated extras for the same visit — they affect how long to budget. */
  additionalRequests: string;
  /** Address is needed to judge travel; full contact is revealed on claim. */
  address: string;
  /** Room the issue is in, and the floor — both affect access and tooling. */
  room: string;
  floor: string;
  /** How many photos the customer attached (revealed in full on claim). */
  photoCount: number;
  location: GeoPoint | null;
}

function toQueueItem(s: Submission): QueueItem {
  return {
    id: s.id,
    createdAt: s.createdAt,
    category: s.triage.category,
    categoryLabel: s.triage.categoryLabel,
    urgency: effectiveUrgency(s),
    clientReported: s.input.clientUrgency != null,
    withinNonLicensedScope: s.triage.withinNonLicensedScope,
    estimatedDurationMin: s.triage.estimatedDurationMin,
    description: s.input.description,
    additionalRequests: s.input.additionalRequests ?? "",
    address: s.input.address,
    room: s.input.room,
    floor: s.input.floor,
    photoCount: s.photoCount ?? 0,
    location: s.location ?? null,
  };
}

export async function getQueue(): Promise<QueueItem[]> {
  const store = await getInitializedStore();
  const jobs = await store.listQueueJobs();
  return jobs.map(toQueueItem);
}

export async function getTechAssignments(techId: string): Promise<Submission[]> {
  const store = await getInitializedStore();
  return store.listTechJobs(techId);
}

export interface ClaimResult {
  ok: boolean;
  job?: Submission;
  reason?: string;
}

/** Atomically claim a queued job for a technician. */
export async function claimJob(
  submissionId: string,
  techId: string,
  techName: string,
): Promise<ClaimResult> {
  const store = await getInitializedStore();
  const assignment: Assignment = {
    techId,
    techName,
    claimedAt: new Date().toISOString(),
    etaMinutes: null,
    etaCommittedAt: null,
    estimatedArrival: null,
  };
  const job = await store.claimJob(submissionId, assignment);
  if (!job) {
    return {
      ok: false,
      reason: "This job was just claimed by another technician.",
    };
  }
  return { ok: true, job };
}

export interface EtaResult {
  ok: boolean;
  job?: Submission;
  reason?: string;
  notified?: { email: boolean; sms: boolean };
}

/**
 * Commit an ETA (30-min increment) on a claimed job, then notify the customer
 * that a technician has been assigned (email always; SMS if they opted in).
 */
export async function commitEta(
  submissionId: string,
  techId: string,
  etaMinutes: number,
  /** Site origin, so the customer notification can link the live tracker. */
  origin?: string | null,
): Promise<EtaResult> {
  if (!ETA_OPTIONS_MIN.includes(etaMinutes)) {
    return { ok: false, reason: "ETA must be a 30-minute increment." };
  }
  const store = await getInitializedStore();
  const committedAt = new Date();
  const estimatedArrival = new Date(
    committedAt.getTime() + etaMinutes * 60_000,
  ).toISOString();

  const job = await store.commitJobEta(
    submissionId,
    techId,
    etaMinutes,
    committedAt.toISOString(),
    estimatedArrival,
  );
  if (!job) {
    return { ok: false, reason: "Job is not assigned to you." };
  }

  const notified = await notifyClientAssigned(job, origin);
  return { ok: true, job, notified };
}

/** Notify the customer that a technician is assigned + ETA. Never throws. */
export async function notifyClientAssigned(
  job: Submission,
  origin?: string | null,
): Promise<{ email: boolean; sms: boolean }> {
  const result = { email: false, sms: false };
  // The tracker link needs an absolute URL. Prefer the configured base URL so
  // links stay correct behind a proxy; fall back to the caller's origin.
  const base = process.env.APP_BASE_URL || origin || null;
  const track = base ? trackingUrl(base, job.id) : null;
  try {
    const emailRes = await sendEmail(technicianAssignedEmail(job, track));
    result.email = emailRes.delivered;
  } catch (err) {
    console.error("Assignment email failed:", err);
  }
  if (job.input.smsOptIn && job.input.phone) {
    try {
      const smsRes = await sendSms({
        to: job.input.phone,
        body: technicianAssignedSms(job, track),
      });
      result.sms = smsRes.delivered;
    } catch (err) {
      console.error("Assignment SMS failed:", err);
    }
  }
  return result;
}

export interface RecordChargeResult {
  ok: boolean;
  charge?: Charge;
  reason?: string;
}

/**
 * Record a charge against a job through the configured payment provider
 * (manual ledger by default; Stripe once connected).
 */
export async function recordCharge(params: {
  submissionId: string;
  techId: string;
  techName: string;
  amountCents: number;
  description: string;
}): Promise<RecordChargeResult> {
  const { submissionId, techId, techName, amountCents, description } = params;
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { ok: false, reason: "Amount must be a positive number." };
  }
  const store = await getInitializedStore();
  const submission = await store.getSubmission(submissionId);
  if (!submission) return { ok: false, reason: "Job not found." };

  const provider = getPaymentProvider();
  let providerRef: string | null = null;
  let status: Charge["status"] = "pending";
  try {
    const res = await provider.createCharge({
      amountCents,
      currency: DEFAULT_CURRENCY,
      description,
      submissionId,
      customerEmail: submission.input.email,
    });
    providerRef = res.providerRef;
    status = res.status;
  } catch (err) {
    console.error("Payment provider error:", err);
    return {
      ok: false,
      reason:
        err instanceof Error ? err.message : "Could not record the charge.",
    };
  }

  const charge: Charge = {
    id: randomUUID(),
    submissionId,
    createdAt: new Date().toISOString(),
    createdByTechId: techId,
    createdByTechName: techName,
    description,
    amountCents,
    currency: DEFAULT_CURRENCY,
    status,
    provider: provider.name,
    providerRef,
  };
  await store.createCharge(charge);
  return { ok: true, charge };
}
