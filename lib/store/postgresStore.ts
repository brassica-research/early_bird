import type { Store, HeuristicConfig } from "./types";
import type {
  Submission,
  FeedbackRecord,
  Slot,
  BookingStatus,
} from "@/lib/types";
import { promises as fs } from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Postgres store — the "flip of a switch" production driver.
//
// To activate:
//   1. `npm install pg`
//   2. Set STORE_DRIVER=postgres and DATABASE_URL=postgres://...
//      (Vercel Postgres, Neon, and Supabase all provide a compatible URL.)
//
// `pg` is imported dynamically via a variable specifier so it is NOT a hard
// dependency of the JSON-mode app: the module is only resolved when this
// driver is actually instantiated. Everything below implements the exact same
// Store contract as the JSON driver, so no calling code changes.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */

const SEED_HEURISTIC = "heuristic-config.seed.json";
const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");

async function loadPg(): Promise<any> {
  // Variable specifier + webpackIgnore keep the bundler from statically
  // requiring `pg`; it is resolved natively at runtime only when selected.
  const moduleName = "pg";
  try {
    return await import(/* webpackIgnore: true */ moduleName);
  } catch {
    throw new Error(
      "STORE_DRIVER=postgres requires the `pg` package. Run `npm install pg`.",
    );
  }
}

export class PostgresStore implements Store {
  private poolPromise: Promise<any> | null = null;

  private async pool(): Promise<any> {
    if (!this.poolPromise) {
      this.poolPromise = (async () => {
        const url = process.env.DATABASE_URL;
        if (!url) {
          throw new Error(
            "STORE_DRIVER=postgres requires DATABASE_URL to be set.",
          );
        }
        const pg = await loadPg();
        const Pool = pg.Pool ?? pg.default?.Pool;
        return new Pool({
          connectionString: url,
          ssl: url.includes("sslmode=disable")
            ? false
            : { rejectUnauthorized: false },
        });
      })();
    }
    return this.poolPromise;
  }

  private async query(text: string, params: any[] = []): Promise<any> {
    const pool = await this.pool();
    return pool.query(text, params);
  }

  async init(): Promise<void> {
    await this.query(`
      CREATE TABLE IF NOT EXISTS submissions (
        id TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL,
        data JSONB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL,
        data JSONB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS slots (
        id TEXT PRIMARY KEY,
        start_ts TIMESTAMPTZ NOT NULL,
        end_ts TIMESTAMPTZ NOT NULL,
        window_label TEXT NOT NULL,
        capacity INT NOT NULL,
        booked INT NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS heuristic_config (
        id INT PRIMARY KEY DEFAULT 1,
        config JSONB NOT NULL
      );
    `);

    // Seed heuristic config from the tracked seed file on first run.
    const existing = await this.query(
      "SELECT config FROM heuristic_config WHERE id = 1",
    );
    if (existing.rows.length === 0) {
      try {
        const raw = await fs.readFile(
          path.join(DATA_DIR, SEED_HEURISTIC),
          "utf8",
        );
        await this.query(
          "INSERT INTO heuristic_config (id, config) VALUES (1, $1) ON CONFLICT (id) DO NOTHING",
          [raw],
        );
      } catch {
        // Seed file missing; getHeuristicConfig will surface a clear error.
      }
    }
  }

  private rowToSlot(r: any): Slot {
    return {
      id: r.id,
      start: new Date(r.start_ts).toISOString(),
      end: new Date(r.end_ts).toISOString(),
      windowLabel: r.window_label,
      capacity: r.capacity,
      booked: r.booked,
    };
  }

  // --- Submissions ---------------------------------------------------------

  async createSubmission(submission: Submission): Promise<Submission> {
    await this.query(
      "INSERT INTO submissions (id, created_at, data) VALUES ($1, $2, $3)",
      [submission.id, submission.createdAt, submission],
    );
    return submission;
  }

  async getSubmission(id: string): Promise<Submission | null> {
    const res = await this.query(
      "SELECT data FROM submissions WHERE id = $1",
      [id],
    );
    return res.rows[0]?.data ?? null;
  }

  async listSubmissions(limit = 100): Promise<Submission[]> {
    const res = await this.query(
      "SELECT data FROM submissions ORDER BY created_at DESC LIMIT $1",
      [limit],
    );
    return res.rows.map((r: any) => r.data);
  }

  async updateSubmissionBooking(
    id: string,
    slotId: string | null,
    status: BookingStatus,
  ): Promise<Submission | null> {
    const res = await this.query(
      `UPDATE submissions
         SET data = jsonb_set(
               jsonb_set(data, '{slotId}', to_jsonb($2::text), true),
               '{bookingStatus}', to_jsonb($3::text), true)
       WHERE id = $1
       RETURNING data`,
      [id, slotId, status],
    );
    return res.rows[0]?.data ?? null;
  }

  // --- Slots ---------------------------------------------------------------

  async listOpenSlots(): Promise<Slot[]> {
    const res = await this.query(
      `SELECT * FROM slots
       WHERE booked < capacity AND start_ts >= now()
       ORDER BY start_ts ASC`,
    );
    return res.rows.map((r: any) => this.rowToSlot(r));
  }

  async getSlot(id: string): Promise<Slot | null> {
    const res = await this.query("SELECT * FROM slots WHERE id = $1", [id]);
    return res.rows[0] ? this.rowToSlot(res.rows[0]) : null;
  }

  async reserveSlot(id: string): Promise<Slot | null> {
    // Atomic guard: only increments when there is remaining capacity.
    const res = await this.query(
      `UPDATE slots SET booked = booked + 1
       WHERE id = $1 AND booked < capacity
       RETURNING *`,
      [id],
    );
    return res.rows[0] ? this.rowToSlot(res.rows[0]) : null;
  }

  async releaseSlot(id: string): Promise<Slot | null> {
    const res = await this.query(
      `UPDATE slots SET booked = GREATEST(0, booked - 1)
       WHERE id = $1 RETURNING *`,
      [id],
    );
    return res.rows[0] ? this.rowToSlot(res.rows[0]) : null;
  }

  async replaceSlots(slots: Slot[]): Promise<void> {
    const pool = await this.pool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM slots");
      for (const s of slots) {
        await client.query(
          `INSERT INTO slots (id, start_ts, end_ts, window_label, capacity, booked)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [s.id, s.start, s.end, s.windowLabel, s.capacity, s.booked],
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async hasSlots(): Promise<boolean> {
    const res = await this.query("SELECT 1 FROM slots LIMIT 1");
    return res.rows.length > 0;
  }

  // --- Feedback loop -------------------------------------------------------

  async appendFeedback(record: FeedbackRecord): Promise<void> {
    await this.query(
      "INSERT INTO feedback (id, created_at, data) VALUES ($1, $2, $3)",
      [record.id, record.createdAt, record],
    );
  }

  async listFeedback(limit = 200): Promise<FeedbackRecord[]> {
    const res = await this.query(
      "SELECT data FROM feedback ORDER BY created_at DESC LIMIT $1",
      [limit],
    );
    return res.rows.map((r: any) => r.data);
  }

  // --- Heuristic config ----------------------------------------------------

  async getHeuristicConfig(): Promise<HeuristicConfig> {
    const res = await this.query(
      "SELECT config FROM heuristic_config WHERE id = 1",
    );
    if (!res.rows[0]) {
      throw new Error("Heuristic config not found in database.");
    }
    return res.rows[0].config;
  }

  async saveHeuristicConfig(config: HeuristicConfig): Promise<HeuristicConfig> {
    await this.query(
      `INSERT INTO heuristic_config (id, config) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config`,
      [config],
    );
    return config;
  }
}
