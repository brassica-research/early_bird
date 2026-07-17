// ---------------------------------------------------------------------------
// Shared domain types for Early Bird.
// These are the contract shared by the API, the triage engine, the store, and
// the (future) mobile app. Keep them serialization-friendly (plain JSON).
// ---------------------------------------------------------------------------

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

/** Contact + issue details captured by the intake form. */
export interface IntakeInput {
  name: string;
  email: string;
  phone: string;
  address: string;
  /** Customer-selected service areas/appliances (chips). */
  affectedServices: string[];
  /** Free-text description of the issue/request. */
  description: string;
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
  notes?: string;
}
