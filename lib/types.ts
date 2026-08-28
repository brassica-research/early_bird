// ---------------------------------------------------------------------------
// Shared domain types for Early Bird.
// These are the contract shared by the API, the triage engine, the store, and
// the (future) mobile app. Keep them serialization-friendly (plain JSON).
// ---------------------------------------------------------------------------

import type { LicensingAssessment } from "./licensing";
import type { IssueAssessment } from "./issues";

export type ServiceCategoryId =
  | "plumbing"
  | "electrical"
  | "appliance"
  | "hvac"
  | "repair"
  | "connectivity"
  | "other";

export type Urgency = "emergency" | "high" | "normal" | "low";

/** How a triage result was produced. */
export type TriageSource = "llm" | "heuristic";

/** A geocoded location (WGS84). */
export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Contact + issue details captured by the intake form. */
export interface IntakeInput {
  name: string;
  email: string;
  phone: string;
  address: string;
  /** USPS state code (e.g. "TX"), used for the state licensing advisory. */
  state?: string;
  /** Customer-selected service areas/appliances/symptoms (drill-down chips). */
  affectedServices: string[];
  /** Which room the issue is in, e.g. "Kitchen" (free text; chips pre-fill). */
  room: string;
  /** Which floor it's on — a FloorId from lib/rooms (e.g. "second"). */
  floor: string;
  /** Free-text description of the issue/request. */
  description: string;
  /**
   * Unrelated extras the customer wants looked at during the same visit
   * ("while you're here, the hall light flickers"). Deliberately kept OUT of
   * triage: classifying the primary issue on a grab-bag of side requests would
   * muddy the category and urgency. It reaches the technician on the job card
   * and the ops inbox, and it IS scanned for safety keywords — a gas smell
   * mentioned in passing still has to raise the banner.
   */
  additionalRequests?: string;
  /** How urgent the customer says it is (used to prioritize the tech queue). */
  clientUrgency?: Urgency;
  /** Whether the customer opted in to SMS text notifications at their number. */
  smsOptIn?: boolean;
}

/** A category score produced by the heuristic classifier. */
export interface CategoryScore {
  category: ServiceCategoryId;
  label: string;
  score: number;
  /** Normalized 0..1 confidence relative to the other categories. */
  confidence: number;
}

/** A safety concern that should escalate out of the normal flow. */
export interface SafetyFlag {
  code: string;
  message: string;
  /** If set, the job is outside a non-licensed technician's scope. */
  requiresLicensedPro: boolean;
}

/** One proposed edit to the heuristic config, emitted by the LLM. */
export interface HeuristicChangeProposal {
  op: "add_keyword" | "adjust_weight" | "add_urgency_rule" | "add_scope_rule";
  category?: ServiceCategoryId;
  term: string;
  weight?: number;
  urgency?: Urgency;
  scopeReason?: string;
  rationale: string;
}

/** Result of triaging one intake. */
export interface TriageResult {
  source: TriageSource;
  category: ServiceCategoryId;
  categoryLabel: string;
  urgency: Urgency;
  /** Whether the job is appropriate for a non-licensed technician. */
  withinNonLicensedScope: boolean;
  safetyFlags: SafetyFlag[];
  /** Ranked category scores from the heuristic (always present). */
  categoryScores: CategoryScore[];
  /** Steps the customer can try before/at the visit (LLM-provided). */
  troubleshootingSteps: string[];
  /** Estimated on-site duration in minutes. */
  estimatedDurationMin: number;
  /** Short human-readable explanation of the triage decision. */
  summary: string;
}

/** Record capturing heuristic-vs-LLM comparison for the feedback loop. */
export interface FeedbackRecord {
  id: string;
  createdAt: string;
  submissionId: string;
  heuristic: TriageResult;
  llm: TriageResult | null;
  llmAvailable: boolean;
  categoriesAgree: boolean;
  urgenciesAgree: boolean;
  scopeAgrees: boolean;
  proposals: HeuristicChangeProposal[];
}

export type BookingStatus = "requested" | "confirmed" | "cancelled";

/** A bookable technician time slot. */
export interface Slot {
  id: string;
  /** ISO start time. */
  start: string;
  /** ISO end time. */
  end: string;
  /** Human label, e.g. "Morning (8am–12pm)". */
  windowLabel: string;
  /** Max concurrent jobs this slot can hold. */
  capacity: number;
  /** Current number of bookings against this slot. */
  booked: number;
}

/** A full intake submission with its triage and (optional) booking. */
// ---------------------------------------------------------------------------
// Technician dispatch
// ---------------------------------------------------------------------------

/**
 * Where a job sits in the technician workflow:
 * queued    — awaiting a technician (visible in every on-duty tech's queue)
 * assigned  — claimed by a technician (locked; removed from the shared queue)
 * en_route  — technician has committed an ETA and is on the way
 * completed — visit finished
 * cancelled — job withdrawn
 */
export type DispatchStatus =
  | "queued"
  | "assigned"
  | "en_route"
  | "completed"
  | "cancelled";

/** A technician's claim on a job, plus their committed arrival. */
export interface Assignment {
  techId: string;
  techName: string;
  /** When the job was claimed (locks it to this tech). */
  claimedAt: string;
  /** Committed ETA in 30-minute increments (e.g. 30, 60, 90). Null until set. */
  etaMinutes: number | null;
  /** When the ETA was committed. */
  etaCommittedAt: string | null;
  /** Estimated arrival ISO timestamp (claim time + etaMinutes). */
  estimatedArrival: string | null;
}

/**
 * Structured details a technician captures on-site to hand a lead off to a
 * licensed / 3rd-party vendor queue. Free-text but as complete as possible so
 * the receiving vendor can act without a second visit.
 */
export interface VendorHandoff {
  /** Trade / vendor type needed, e.g. "Licensed electrician". */
  trade: string;
  /** What the vendor needs to do. */
  scope: string;
  /** What the technician found on-site (measurements, model #s, condition). */
  findings: string;
  /** Parts or materials involved. */
  parts: string;
  /** Access notes: gate code, pets, parking, best entrance. */
  accessNotes: string;
  /** Customer's preferred timing / availability. */
  preferredTiming: string;
  /** Anything else useful for the vendor. */
  notes: string;
}

/** A technician's close-out report on a claimed job. */
export interface JobReport {
  /** Did the technician resolve the issue on-site? Null until answered. */
  resolved: boolean | null;
  /** Issue summary + what was done / current state. */
  progress: string;
  /** Vendor-handoff packet, when the lead is passed on. Null otherwise. */
  vendorHandoff: VendorHandoff | null;
  /** When the report was last saved. */
  updatedAt: string;
}

export interface Submission {
  id: string;
  createdAt: string;
  input: IntakeInput;
  /** The triage result surfaced to the customer (LLM when available). */
  triage: TriageResult;
  /** The heuristic result, retained for auditing even when LLM is primary. */
  heuristicTriage: TriageResult;
  slotId: string | null;
  bookingStatus: BookingStatus;
  /** Geocoded location of the service address (best-effort; null if unknown). */
  location?: GeoPoint | null;
  /** Technician-dispatch state. Every new submission starts "queued". */
  dispatchStatus: DispatchStatus;
  /** The claiming technician + committed ETA, once assigned. */
  assignment?: Assignment | null;
  /**
   * State licensing advisory for this job, computed at intake from the
   * customer's state + triaged trade. Advisory only; null when the state is
   * unknown or the trade carries no state gate.
   */
  licensing?: LicensingAssessment | null;
  /**
   * Best-matching catalog issue + fixability verdict from the Issues Matrix,
   * computed at intake from the description + selected chips. Advisory only.
   */
  issueAssessment?: IssueAssessment | null;
  /** How many photos the customer attached (the bytes live in the photo store). */
  photoCount?: number;
  /** The visit fee quoted + collected at checkout. Null until payment. */
  visitFee?: VisitFeePayment | null;
  /** Technician's close-out report (resolved?, progress, vendor handoff). */
  report?: JobReport | null;
  /** When the technician manually sent the customer a review request. */
  reviewRequestedAt?: string | null;
  notes?: string;
}

/**
 * The client-safe effective urgency used to prioritize the queue: the
 * customer's self-reported urgency when given, else the triaged urgency.
 */
export function effectiveUrgency(s: {
  input: IntakeInput;
  triage: TriageResult;
}): Urgency {
  return s.input.clientUrgency ?? s.triage.urgency;
}

/** Numeric rank for sorting urgencies (higher = more urgent). */
export const URGENCY_RANK: Record<Urgency, number> = {
  emergency: 3,
  high: 2,
  normal: 1,
  low: 0,
};

// ---------------------------------------------------------------------------
// Technician accounts + password reset
// ---------------------------------------------------------------------------

/** A technician's login account. The password is never stored in the clear. */
export interface TechnicianAccount {
  id: string;
  name: string;
  /** Lower-cased email; the login identifier. */
  email: string;
  phone?: string;
  /** Encoded scrypt hash (algorithm$params$salt$hash). */
  passwordHash: string;
  /** Base32 TOTP secret, if the technician has enrolled a second factor. */
  totpSecret?: string | null;
  /** Whether the second factor is active (verified during enrollment). */
  totpEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
  disabled?: boolean;
}

/**
 * A technician on-duty session: clock-in to clock-out. Retained long-term
 * (up to 5 years) so the admin can review duty history.
 */
export interface DutySession {
  id: string;
  techId: string;
  clockInAt: string;
  clockOutAt: string | null;
}

/** Live technician presence: on-duty status and last-known location. */
export interface TechPresence {
  techId: string;
  onDuty: boolean;
  location: GeoPoint | null;
  lastSeenAt: string;
}

/**
 * A password-reset token record. Only the SHA-256 HASH of the token is stored
 * (the raw token lives only in the emailed link), it is single-use, and it
 * expires — per the OWASP Forgot Password guidance.
 */
export interface PasswordResetToken {
  /** SHA-256 hex of the raw token — the lookup key. */
  tokenHash: string;
  techId: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export type ChargeStatus =
  | "draft" // recorded, not yet submitted for payment
  | "pending" // submitted to a processor, awaiting settlement
  | "paid"
  | "void"
  | "refunded";

/**
 * A charge a technician records against a job. Kept processor-agnostic: the
 * `provider` + `providerRef` fields point at whatever payment processor is
 * connected (manual ledger by default; Stripe once configured).
 */
export interface Charge {
  id: string;
  submissionId: string;
  createdAt: string;
  createdByTechId: string;
  createdByTechName: string;
  description: string;
  amountCents: number;
  currency: string;
  status: ChargeStatus;
  /** Payment provider that owns this charge, e.g. "manual" | "stripe". */
  provider: string;
  /** Processor-side id (e.g. Stripe PaymentIntent id). Null for manual. */
  providerRef: string | null;
}

// ---------------------------------------------------------------------------
// Intake photos
// ---------------------------------------------------------------------------

/**
 * A photo the customer attached at intake ("here's the leak"). Stored in its
 * own collection rather than on the Submission so that listing submissions,
 * queues and dispatch boards never drags image bytes along with them.
 *
 * The browser downscales and re-encodes before upload (see the intake form),
 * so `dataUrl` is a modest, already-normalized image rather than a raw 12MP
 * phone capture. Limits are enforced again server-side — see lib/rooms.
 */
export interface JobPhoto {
  id: string;
  submissionId: string;
  createdAt: string;
  /** Original filename, for the technician's reference. May be empty. */
  name: string;
  contentType: string;
  /** Full `data:` URL (base64). Rendered directly by the tech app. */
  dataUrl: string;
  width: number;
  height: number;
  /** Decoded size of the image in bytes. */
  bytes: number;
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

/**
 * The visit fee taken at checkout, recorded on the submission.
 *
 * Card data is intentionally minimal: the full number never reaches this
 * server. The browser validates it and sends only the brand, last four digits
 * and expiry so the customer (and the technician) can recognize the card on a
 * receipt — everything else is the payment provider's job.
 */
export interface VisitFeePayment {
  /** "day" (8am–4pm) or "evening" (4pm–9pm) — see lib/pricing. */
  tier: "day" | "evening";
  amountCents: number;
  currency: string;
  /** The Charge record this payment created. */
  chargeId: string;
  status: ChargeStatus;
  paidAt: string;
  /** Card brand as detected in the browser, e.g. "visa". */
  cardBrand: string;
  /** Last four digits only. */
  cardLast4: string;
  /** The slot this fee was priced against, for auditing. */
  slotId: string;
}
