import { promises as fs } from "fs";
import path from "path";
import type { Store, HeuristicConfig } from "./types";
import type {
  Submission,
  FeedbackRecord,
  Slot,
  BookingStatus,
  Assignment,
  Charge,
  ChargeStatus,
  TechnicianAccount,
  PasswordResetToken,
  TechPresence,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// JSON file store.
//
// A dependency-free persistence driver that keeps each collection in its own
// JSON file under DATA_DIR. All mutations are serialized through a simple
// in-process promise chain (mutex) so concurrent request handlers in a single
// Node process cannot interleave read-modify-write and corrupt a file.
//
// This is intended for local dev and low-volume MVP use. For production /
// serverless (where the filesystem is ephemeral and there are many processes),
// flip STORE_DRIVER=postgres — see ./postgresStore.ts.
// ---------------------------------------------------------------------------

const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");

const FILES = {
  submissions: "submissions.json",
  feedback: "feedback.json",
  slots: "slots.json",
  charges: "charges.json",
  techAccounts: "tech-accounts.json",
  resetTokens: "reset-tokens.json",
  presence: "tech-presence.json",
  heuristicLive: "heuristic-config.live.json",
} as const;

const SEEDS = {
  heuristic: "heuristic-config.seed.json",
} as const;

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, file), "utf8");
    return JSON.parse(raw) as T;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw err;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  const full = path.join(DATA_DIR, file);
  const tmp = `${full}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  // Atomic-ish replace so a crash mid-write can't truncate the real file.
  await fs.rename(tmp, full);
}

export class JsonFileStore implements Store {
  /** Serializes all writes across the process. */
  private queue: Promise<unknown> = Promise.resolve();

  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    // Keep the chain alive regardless of individual outcomes.
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async init(): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    // Seed the live heuristic config from the tracked seed on first run.
    const livePath = path.join(DATA_DIR, FILES.heuristicLive);
    try {
      await fs.access(livePath);
    } catch {
      const seed = await readJson<HeuristicConfig | null>(SEEDS.heuristic, null);
      if (seed) await writeJson(FILES.heuristicLive, seed);
    }
  }

  // --- Submissions ---------------------------------------------------------

  async createSubmission(submission: Submission): Promise<Submission> {
    return this.locked(async () => {
      const all = await readJson<Submission[]>(FILES.submissions, []);
      all.push(submission);
      await writeJson(FILES.submissions, all);
      return submission;
    });
  }

  async getSubmission(id: string): Promise<Submission | null> {
    const all = await readJson<Submission[]>(FILES.submissions, []);
    return all.find((s) => s.id === id) ?? null;
  }

  async listSubmissions(limit = 100): Promise<Submission[]> {
    const all = await readJson<Submission[]>(FILES.submissions, []);
    return all
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async updateSubmissionBooking(
    id: string,
    slotId: string | null,
    status: BookingStatus,
  ): Promise<Submission | null> {
    return this.locked(async () => {
      const all = await readJson<Submission[]>(FILES.submissions, []);
      const idx = all.findIndex((s) => s.id === id);
      if (idx === -1) return null;
      all[idx] = { ...all[idx], slotId, bookingStatus: status };
      await writeJson(FILES.submissions, all);
      return all[idx];
    });
  }

  // --- Technician dispatch -------------------------------------------------

  async listQueueJobs(): Promise<Submission[]> {
    const all = await readJson<Submission[]>(FILES.submissions, []);
    return all
      .filter((s) => s.dispatchStatus === "queued")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listTechJobs(techId: string): Promise<Submission[]> {
    const all = await readJson<Submission[]>(FILES.submissions, []);
    return all
      .filter(
        (s) =>
          s.assignment?.techId === techId &&
          (s.dispatchStatus === "assigned" || s.dispatchStatus === "en_route"),
      )
      .sort((a, b) =>
        (b.assignment?.claimedAt ?? "").localeCompare(
          a.assignment?.claimedAt ?? "",
        ),
      );
  }

  async claimJob(
    submissionId: string,
    assignment: Assignment,
  ): Promise<Submission | null> {
    return this.locked(async () => {
      const all = await readJson<Submission[]>(FILES.submissions, []);
      const idx = all.findIndex((s) => s.id === submissionId);
      if (idx === -1) return null;
      // Only a still-queued job can be claimed — this is the atomic guard.
      if (all[idx].dispatchStatus !== "queued") return null;
      all[idx] = {
        ...all[idx],
        dispatchStatus: "assigned",
        assignment,
      };
      await writeJson(FILES.submissions, all);
      return all[idx];
    });
  }

  async commitJobEta(
    submissionId: string,
    techId: string,
    etaMinutes: number,
    etaCommittedAt: string,
    estimatedArrival: string,
  ): Promise<Submission | null> {
    return this.locked(async () => {
      const all = await readJson<Submission[]>(FILES.submissions, []);
      const idx = all.findIndex((s) => s.id === submissionId);
      if (idx === -1) return null;
      const job = all[idx];
      // Must be claimed by this tech and not already completed/cancelled.
      if (
        job.assignment?.techId !== techId ||
        (job.dispatchStatus !== "assigned" && job.dispatchStatus !== "en_route")
      ) {
        return null;
      }
      all[idx] = {
        ...job,
        dispatchStatus: "en_route",
        assignment: {
          ...job.assignment,
          etaMinutes,
          etaCommittedAt,
          estimatedArrival,
        },
      };
      await writeJson(FILES.submissions, all);
      return all[idx];
    });
  }

  // --- Technician accounts + password reset --------------------------------

  async createTechAccount(
    account: TechnicianAccount,
  ): Promise<TechnicianAccount> {
    return this.locked(async () => {
      const all = await readJson<TechnicianAccount[]>(FILES.techAccounts, []);
      all.push(account);
      await writeJson(FILES.techAccounts, all);
      return account;
    });
  }

  async getTechAccountByEmail(
    email: string,
  ): Promise<TechnicianAccount | null> {
    const all = await readJson<TechnicianAccount[]>(FILES.techAccounts, []);
    const lower = email.trim().toLowerCase();
    return all.find((a) => a.email === lower) ?? null;
  }

  async getTechAccountById(id: string): Promise<TechnicianAccount | null> {
    const all = await readJson<TechnicianAccount[]>(FILES.techAccounts, []);
    return all.find((a) => a.id === id) ?? null;
  }

  async updateTechPassword(
    id: string,
    passwordHash: string,
  ): Promise<TechnicianAccount | null> {
    return this.locked(async () => {
      const all = await readJson<TechnicianAccount[]>(FILES.techAccounts, []);
      const idx = all.findIndex((a) => a.id === id);
      if (idx === -1) return null;
      all[idx] = {
        ...all[idx],
        passwordHash,
        updatedAt: new Date().toISOString(),
      };
      await writeJson(FILES.techAccounts, all);
      return all[idx];
    });
  }

  async createResetToken(token: PasswordResetToken): Promise<void> {
    await this.locked(async () => {
      const all = await readJson<PasswordResetToken[]>(FILES.resetTokens, []);
      // Invalidate the tech's prior unused tokens (single active token).
      for (const t of all) {
        if (t.techId === token.techId && !t.usedAt) {
          t.usedAt = new Date().toISOString();
        }
      }
      all.push(token);
      await writeJson(FILES.resetTokens, all);
    });
  }

  async getResetToken(
    tokenHash: string,
  ): Promise<PasswordResetToken | null> {
    const all = await readJson<PasswordResetToken[]>(FILES.resetTokens, []);
    return all.find((t) => t.tokenHash === tokenHash) ?? null;
  }

  async markResetTokenUsed(tokenHash: string, usedAt: string): Promise<void> {
    await this.locked(async () => {
      const all = await readJson<PasswordResetToken[]>(FILES.resetTokens, []);
      const idx = all.findIndex((t) => t.tokenHash === tokenHash);
      if (idx === -1) return;
      all[idx] = { ...all[idx], usedAt };
      await writeJson(FILES.resetTokens, all);
    });
  }

  async listTechAccounts(): Promise<TechnicianAccount[]> {
    const all = await readJson<TechnicianAccount[]>(FILES.techAccounts, []);
    return all.slice().sort((a, b) => a.name.localeCompare(b.name));
  }

  // --- Technician presence -------------------------------------------------

  async upsertPresence(presence: TechPresence): Promise<void> {
    await this.locked(async () => {
      const all = await readJson<TechPresence[]>(FILES.presence, []);
      const idx = all.findIndex((p) => p.techId === presence.techId);
      if (idx === -1) all.push(presence);
      else all[idx] = presence;
      await writeJson(FILES.presence, all);
    });
  }

  async listPresence(): Promise<TechPresence[]> {
    return readJson<TechPresence[]>(FILES.presence, []);
  }

  // --- Billing -------------------------------------------------------------

  async createCharge(charge: Charge): Promise<Charge> {
    return this.locked(async () => {
      const all = await readJson<Charge[]>(FILES.charges, []);
      all.push(charge);
      await writeJson(FILES.charges, all);
      return charge;
    });
  }

  async listChargesForSubmission(submissionId: string): Promise<Charge[]> {
    const all = await readJson<Charge[]>(FILES.charges, []);
    return all
      .filter((c) => c.submissionId === submissionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async listCharges(limit = 200): Promise<Charge[]> {
    const all = await readJson<Charge[]>(FILES.charges, []);
    return all
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async updateChargeStatus(
    id: string,
    status: ChargeStatus,
    providerRef?: string | null,
  ): Promise<Charge | null> {
    return this.locked(async () => {
      const all = await readJson<Charge[]>(FILES.charges, []);
      const idx = all.findIndex((c) => c.id === id);
      if (idx === -1) return null;
      all[idx] = {
        ...all[idx],
        status,
        ...(providerRef !== undefined ? { providerRef } : {}),
      };
      await writeJson(FILES.charges, all);
      return all[idx];
    });
  }

  // --- Slots ---------------------------------------------------------------

  async listOpenSlots(): Promise<Slot[]> {
    const now = new Date().toISOString();
    const all = await readJson<Slot[]>(FILES.slots, []);
    return all
      .filter((s) => s.booked < s.capacity && s.start >= now)
      .sort((a, b) => a.start.localeCompare(b.start));
  }

  async getSlot(id: string): Promise<Slot | null> {
    const all = await readJson<Slot[]>(FILES.slots, []);
    return all.find((s) => s.id === id) ?? null;
  }

  async reserveSlot(id: string): Promise<Slot | null> {
    return this.locked(async () => {
      const all = await readJson<Slot[]>(FILES.slots, []);
      const idx = all.findIndex((s) => s.id === id);
      if (idx === -1) return null;
      if (all[idx].booked >= all[idx].capacity) return null;
      all[idx] = { ...all[idx], booked: all[idx].booked + 1 };
      await writeJson(FILES.slots, all);
      return all[idx];
    });
  }

  async releaseSlot(id: string): Promise<Slot | null> {
    return this.locked(async () => {
      const all = await readJson<Slot[]>(FILES.slots, []);
      const idx = all.findIndex((s) => s.id === id);
      if (idx === -1) return null;
      all[idx] = { ...all[idx], booked: Math.max(0, all[idx].booked - 1) };
      await writeJson(FILES.slots, all);
      return all[idx];
    });
  }

  async replaceSlots(slots: Slot[]): Promise<void> {
    await this.locked(async () => {
      await writeJson(FILES.slots, slots);
    });
  }

  async hasSlots(): Promise<boolean> {
    const all = await readJson<Slot[]>(FILES.slots, []);
    return all.length > 0;
  }

  // --- Feedback loop -------------------------------------------------------

  async appendFeedback(record: FeedbackRecord): Promise<void> {
    await this.locked(async () => {
      const all = await readJson<FeedbackRecord[]>(FILES.feedback, []);
      all.push(record);
      await writeJson(FILES.feedback, all);
    });
  }

  async listFeedback(limit = 200): Promise<FeedbackRecord[]> {
    const all = await readJson<FeedbackRecord[]>(FILES.feedback, []);
    return all
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  // --- Heuristic config ----------------------------------------------------

  async getHeuristicConfig(): Promise<HeuristicConfig> {
    const live = await readJson<HeuristicConfig | null>(
      FILES.heuristicLive,
      null,
    );
    if (live) return live;
    // Fall back to the seed if init hasn't run yet.
    const seed = await readJson<HeuristicConfig | null>(SEEDS.heuristic, null);
    if (seed) return seed;
    throw new Error("Heuristic config not found (no live file and no seed).");
  }

  async saveHeuristicConfig(config: HeuristicConfig): Promise<HeuristicConfig> {
    return this.locked(async () => {
      await writeJson(FILES.heuristicLive, config);
      return config;
    });
  }
}
