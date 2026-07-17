import type {
  Submission,
  FeedbackRecord,
  Slot,
  BookingStatus,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Storage contract.
//
// Everything the app persists goes through this interface. The default driver
// writes JSON files under ./data; a Postgres driver can be dropped in behind
// the same interface by flipping STORE_DRIVER=postgres (see ./index.ts and
// ./postgresStore.ts). No app or API code imports a concrete driver directly.
// ---------------------------------------------------------------------------

export interface HeuristicConfig {
  version: number;
  updatedAt: string;
  categories: Array<{
    id: string;
    label: string;
    baseDurationMin: number;
    keywords: Array<{ term: string; weight: number }>;
  }>;
  urgencyRules: Array<{ term: string; urgency: string; weight: number }>;
  scopeRules: Array<{ term: string; reason: string }>;
}

export interface Store {
  /** One-time initialization (create tables / seed files). Idempotent. */
  init(): Promise<void>;

  // --- Submissions ---------------------------------------------------------
  createSubmission(submission: Submission): Promise<Submission>;
  getSubmission(id: string): Promise<Submission | null>;
  listSubmissions(limit?: number): Promise<Submission[]>;
  updateSubmissionBooking(
    id: string,
    slotId: string | null,
    status: BookingStatus,
  ): Promise<Submission | null>;

  // --- Slots ---------------------------------------------------------------
  /** Return open slots (booked < capacity) with start >= now, sorted by start. */
  listOpenSlots(): Promise<Slot[]>;
  getSlot(id: string): Promise<Slot | null>;
  /**
   * Atomically reserve one unit of capacity on a slot. Returns the updated
   * slot, or null if the slot is missing or already full (caller treats null
   * as "slot no longer available").
   */
  reserveSlot(id: string): Promise<Slot | null>;
  /** Release one unit of capacity (e.g. on cancellation). */
  releaseSlot(id: string): Promise<Slot | null>;
  /** Replace the full slot set (used to (re)generate the schedule). */
  replaceSlots(slots: Slot[]): Promise<void>;
  /** True if any slots exist (used to decide whether to seed). */
  hasSlots(): Promise<boolean>;

  // --- Feedback loop -------------------------------------------------------
  appendFeedback(record: FeedbackRecord): Promise<void>;
  listFeedback(limit?: number): Promise<FeedbackRecord[]>;

  // --- Heuristic config ----------------------------------------------------
  getHeuristicConfig(): Promise<HeuristicConfig>;
  saveHeuristicConfig(config: HeuristicConfig): Promise<HeuristicConfig>;
}
