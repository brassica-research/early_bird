import { promises as fs } from "fs";
import path from "path";
import type { Store, HeuristicConfig } from "./types";
import type {
  Submission,
  FeedbackRecord,
  Slot,
  BookingStatus,
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
