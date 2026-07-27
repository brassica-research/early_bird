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

  // --- Technician dispatch -------------------------------------------------
  /** Jobs still awaiting a technician (dispatchStatus "queued"). */
  listQueueJobs(): Promise<Submission[]>;
  /** Jobs currently assigned to a technician (assigned/en_route). */
  listTechJobs(techId: string): Promise<Submission[]>;
  /**
   * Atomically claim a queued job for a technician. Returns the updated
   * submission, or null if it is no longer queued (another tech won the race).
   */
  claimJob(
    submissionId: string,
    assignment: import("@/lib/types").Assignment,
  ): Promise<Submission | null>;
  /**
   * Commit an ETA on a job the given technician has claimed. Returns the
   * updated submission, or null if the job isn't assigned to that tech.
   */
  commitJobEta(
    submissionId: string,
    techId: string,
    etaMinutes: number,
    etaCommittedAt: string,
    estimatedArrival: string,
  ): Promise<Submission | null>;

  // --- Technician accounts + password reset --------------------------------
  createTechAccount(
    account: import("@/lib/types").TechnicianAccount,
  ): Promise<import("@/lib/types").TechnicianAccount>;
  getTechAccountByEmail(
    email: string,
  ): Promise<import("@/lib/types").TechnicianAccount | null>;
  getTechAccountById(
    id: string,
  ): Promise<import("@/lib/types").TechnicianAccount | null>;
  updateTechPassword(
    id: string,
    passwordHash: string,
  ): Promise<import("@/lib/types").TechnicianAccount | null>;
  /** Set (or clear) a technician's TOTP secret + enabled flag. */
  updateTechTotp(
    id: string,
    totpSecret: string | null,
    totpEnabled: boolean,
  ): Promise<import("@/lib/types").TechnicianAccount | null>;
  /** All jobs ever assigned to a technician (any dispatch status), newest first. */
  listAllTechJobs(techId: string): Promise<import("@/lib/types").Submission[]>;

  // --- Duty sessions (clock in/out history) --------------------------------
  /** Open a duty session for the tech if none is open; returns the open one. */
  openDutySession(
    session: import("@/lib/types").DutySession,
  ): Promise<import("@/lib/types").DutySession>;
  /** Close the tech's open duty session, if any. */
  closeOpenDutySession(
    techId: string,
    clockOutAt: string,
  ): Promise<import("@/lib/types").DutySession | null>;
  /** Duty sessions for a tech at/after `sinceIso`, newest first. */
  listDutySessions(
    techId: string,
    sinceIso?: string,
  ): Promise<import("@/lib/types").DutySession[]>;
  /** Store a reset token (only its hash) and invalidate the tech's prior ones. */
  createResetToken(
    token: import("@/lib/types").PasswordResetToken,
  ): Promise<void>;
  getResetToken(
    tokenHash: string,
  ): Promise<import("@/lib/types").PasswordResetToken | null>;
  markResetTokenUsed(tokenHash: string, usedAt: string): Promise<void>;
  /** All technician accounts (admin roster). */
  listTechAccounts(): Promise<import("@/lib/types").TechnicianAccount[]>;

  // --- Technician presence -------------------------------------------------
  upsertPresence(presence: import("@/lib/types").TechPresence): Promise<void>;
  listPresence(): Promise<import("@/lib/types").TechPresence[]>;

  // --- Billing -------------------------------------------------------------
  createCharge(
    charge: import("@/lib/types").Charge,
  ): Promise<import("@/lib/types").Charge>;
  listChargesForSubmission(
    submissionId: string,
  ): Promise<import("@/lib/types").Charge[]>;
  listCharges(limit?: number): Promise<import("@/lib/types").Charge[]>;
  updateChargeStatus(
    id: string,
    status: import("@/lib/types").ChargeStatus,
    providerRef?: string | null,
  ): Promise<import("@/lib/types").Charge | null>;

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
