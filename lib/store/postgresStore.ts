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
  DutySession,
  JobPhoto,
  VisitFeePayment,
} from "@/lib/types";
// Import the seed as a module so it's bundled into the serverless function.
// (Reading it from disk fails on Vercel, where the seed file isn't traced into
// the deploy — the cause of "Heuristic config not found in database".)
import heuristicSeed from "@/data/heuristic-config.seed.json";

// ---------------------------------------------------------------------------
// Postgres store — the "flip of a switch" production driver.
//
// To activate:
//   Set STORE_DRIVER=postgres and DATABASE_URL=postgres://...
//   (Vercel Postgres, Neon, and Supabase all provide a compatible URL.)
//
// `pg` ships as a dependency but is imported dynamically via a variable
// specifier, so JSON mode never opens a connection: the module is only
// resolved when this driver is actually instantiated. Everything below
// implements the exact same Store contract as the JSON driver, so no calling
// code changes.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Build node-postgres Pool options. We parse out any `sslmode` from the
 * connection string and set `ssl` explicitly so (1) pg doesn't print its
 * "sslmode require/prefer/verify-ca are aliases for verify-full" deprecation
 * warning, and (2) TLS behavior stays deterministic across pg versions instead
 * of tracking the soon-to-change sslmode alias semantics.
 *
 * Hosted Postgres (Prisma/Neon/Supabase/Vercel) serves a valid public cert, so
 * we verify it by default. Set PG_SSL_NO_VERIFY=true for self-signed certs.
 */
function poolOptions(url: string): { connectionString: string; ssl: any } {
  let connectionString = url;
  let sslmode: string | null = null;
  try {
    const u = new URL(url);
    sslmode = u.searchParams.get("sslmode");
    if (sslmode !== null) {
      u.searchParams.delete("sslmode");
      connectionString = u.toString();
    }
  } catch {
    // Not URL-parseable — fall back to the raw string + substring check below.
    if (/[?&]sslmode=disable(&|$)/.test(url)) sslmode = "disable";
  }
  if (sslmode === "disable") return { connectionString, ssl: false };
  return {
    connectionString,
    ssl: { rejectUnauthorized: process.env.PG_SSL_NO_VERIFY !== "true" },
  };
}

async function loadPg(): Promise<any> {
  // Literal specifier so Next's file tracer includes `pg` in the serverless
  // bundle; it's marked external (next.config `serverExternalPackages`) so the
  // bundler still doesn't try to inline it. Imported lazily so JSON mode never
  // needs a live DB.
  try {
    return await import("pg");
  } catch (err) {
    throw new Error(
      "STORE_DRIVER=postgres could not load the `pg` package: " +
        (err instanceof Error ? err.message : String(err)),
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
        return new Pool(poolOptions(url));
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
      CREATE TABLE IF NOT EXISTS charges (
        id TEXT PRIMARY KEY,
        submission_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        data JSONB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tech_accounts (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        data JSONB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reset_tokens (
        token_hash TEXT PRIMARY KEY,
        tech_id TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        data JSONB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tech_presence (
        tech_id TEXT PRIMARY KEY,
        data JSONB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS duty_sessions (
        id TEXT PRIMARY KEY,
        tech_id TEXT NOT NULL,
        clock_in_at TIMESTAMPTZ NOT NULL,
        clock_out_at TIMESTAMPTZ,
        data JSONB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS duty_tech_idx ON duty_sessions (tech_id, clock_in_at DESC);
      CREATE INDEX IF NOT EXISTS duty_open_idx ON duty_sessions (tech_id) WHERE clock_out_at IS NULL;
      CREATE TABLE IF NOT EXISTS job_photos (
        id TEXT PRIMARY KEY,
        submission_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        data JSONB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS job_photos_submission_idx
        ON job_photos (submission_id, created_at);
      CREATE INDEX IF NOT EXISTS charges_submission_idx
        ON charges (submission_id);
      CREATE INDEX IF NOT EXISTS submissions_dispatch_idx
        ON submissions ((data->>'dispatchStatus'));
    `);

    // Seed heuristic config from the bundled seed on first run.
    const existing = await this.query(
      "SELECT config FROM heuristic_config WHERE id = 1",
    );
    if (existing.rows.length === 0) {
      await this.query(
        "INSERT INTO heuristic_config (id, config) VALUES (1, $1) ON CONFLICT (id) DO NOTHING",
        [JSON.stringify(heuristicSeed)],
      );
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

  async setSubmissionVisitFee(
    id: string,
    visitFee: VisitFeePayment,
  ): Promise<Submission | null> {
    const res = await this.query(
      `UPDATE submissions
         SET data = jsonb_set(data, '{visitFee}', $2::jsonb, true)
       WHERE id = $1
       RETURNING data`,
      [id, JSON.stringify(visitFee)],
    );
    return res.rows[0]?.data ?? null;
  }

  // --- Intake photos -------------------------------------------------------

  async createPhotos(photos: JobPhoto[]): Promise<void> {
    for (const photo of photos) {
      await this.query(
        `INSERT INTO job_photos (id, submission_id, created_at, data)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [photo.id, photo.submissionId, photo.createdAt, photo],
      );
    }
  }

  async listPhotosForSubmission(submissionId: string): Promise<JobPhoto[]> {
    const res = await this.query(
      `SELECT data FROM job_photos
       WHERE submission_id = $1
       ORDER BY created_at ASC`,
      [submissionId],
    );
    return res.rows.map((r: any) => r.data);
  }

  // --- Technician dispatch -------------------------------------------------

  async listQueueJobs(): Promise<Submission[]> {
    const res = await this.query(
      `SELECT data FROM submissions
       WHERE data->>'dispatchStatus' = 'queued'
       ORDER BY created_at DESC`,
    );
    return res.rows.map((r: any) => r.data);
  }

  async listTechJobs(techId: string): Promise<Submission[]> {
    const res = await this.query(
      `SELECT data FROM submissions
       WHERE data#>>'{assignment,techId}' = $1
         AND data->>'dispatchStatus' IN ('assigned', 'en_route')
       ORDER BY data#>>'{assignment,claimedAt}' DESC`,
      [techId],
    );
    return res.rows.map((r: any) => r.data);
  }

  async claimJob(
    submissionId: string,
    assignment: Assignment,
  ): Promise<Submission | null> {
    // Atomic guard: the WHERE clause only matches a still-queued job, so two
    // concurrent claims can never both succeed.
    const res = await this.query(
      `UPDATE submissions
         SET data = jsonb_set(
               jsonb_set(data, '{dispatchStatus}', to_jsonb('assigned'::text), true),
               '{assignment}', $2::jsonb, true)
       WHERE id = $1 AND data->>'dispatchStatus' = 'queued'
       RETURNING data`,
      [submissionId, JSON.stringify(assignment)],
    );
    return res.rows[0]?.data ?? null;
  }

  async commitJobEta(
    submissionId: string,
    techId: string,
    etaMinutes: number,
    etaCommittedAt: string,
    estimatedArrival: string,
  ): Promise<Submission | null> {
    const res = await this.query(
      `UPDATE submissions
         SET data = jsonb_set(
               jsonb_set(
                 jsonb_set(
                   jsonb_set(data, '{dispatchStatus}', to_jsonb('en_route'::text), true),
                   '{assignment,etaMinutes}', to_jsonb($3::int), true),
                 '{assignment,etaCommittedAt}', to_jsonb($4::text), true),
               '{assignment,estimatedArrival}', to_jsonb($5::text), true)
       WHERE id = $1
         AND data#>>'{assignment,techId}' = $2
         AND data->>'dispatchStatus' IN ('assigned', 'en_route')
       RETURNING data`,
      [submissionId, techId, etaMinutes, etaCommittedAt, estimatedArrival],
    );
    return res.rows[0]?.data ?? null;
  }

  // --- Technician accounts + password reset --------------------------------

  async createTechAccount(
    account: TechnicianAccount,
  ): Promise<TechnicianAccount> {
    await this.query(
      "INSERT INTO tech_accounts (id, email, data) VALUES ($1, $2, $3)",
      [account.id, account.email, account],
    );
    return account;
  }

  async getTechAccountByEmail(
    email: string,
  ): Promise<TechnicianAccount | null> {
    const res = await this.query(
      "SELECT data FROM tech_accounts WHERE email = $1",
      [email.trim().toLowerCase()],
    );
    return res.rows[0]?.data ?? null;
  }

  async getTechAccountById(id: string): Promise<TechnicianAccount | null> {
    const res = await this.query(
      "SELECT data FROM tech_accounts WHERE id = $1",
      [id],
    );
    return res.rows[0]?.data ?? null;
  }

  async updateTechPassword(
    id: string,
    passwordHash: string,
  ): Promise<TechnicianAccount | null> {
    const res = await this.query(
      `UPDATE tech_accounts
         SET data = jsonb_set(
               jsonb_set(data, '{passwordHash}', to_jsonb($2::text), true),
               '{updatedAt}', to_jsonb($3::text), true)
       WHERE id = $1
       RETURNING data`,
      [id, passwordHash, new Date().toISOString()],
    );
    return res.rows[0]?.data ?? null;
  }

  async createResetToken(token: PasswordResetToken): Promise<void> {
    const client = await (await this.pool()).connect();
    try {
      await client.query("BEGIN");
      // Invalidate the tech's prior unused tokens (single active token).
      await client.query(
        `UPDATE reset_tokens
           SET data = jsonb_set(data, '{usedAt}', to_jsonb($2::text), true)
         WHERE tech_id = $1 AND data->>'usedAt' IS NULL`,
        [token.techId, new Date().toISOString()],
      );
      await client.query(
        `INSERT INTO reset_tokens (token_hash, tech_id, expires_at, data)
         VALUES ($1, $2, $3, $4)`,
        [token.tokenHash, token.techId, token.expiresAt, token],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async getResetToken(tokenHash: string): Promise<PasswordResetToken | null> {
    const res = await this.query(
      "SELECT data FROM reset_tokens WHERE token_hash = $1",
      [tokenHash],
    );
    return res.rows[0]?.data ?? null;
  }

  async markResetTokenUsed(tokenHash: string, usedAt: string): Promise<void> {
    await this.query(
      `UPDATE reset_tokens
         SET data = jsonb_set(data, '{usedAt}', to_jsonb($2::text), true)
       WHERE token_hash = $1`,
      [tokenHash, usedAt],
    );
  }

  async listTechAccounts(): Promise<TechnicianAccount[]> {
    const res = await this.query(
      "SELECT data FROM tech_accounts ORDER BY data->>'name' ASC",
    );
    return res.rows.map((r: any) => r.data);
  }

  async updateTechTotp(
    id: string,
    totpSecret: string | null,
    totpEnabled: boolean,
  ): Promise<TechnicianAccount | null> {
    const res = await this.query(
      `UPDATE tech_accounts
         SET data = jsonb_set(
               jsonb_set(
                 jsonb_set(data, '{totpSecret}', $2::jsonb, true),
                 '{totpEnabled}', to_jsonb($3::boolean), true),
               '{updatedAt}', to_jsonb($4::text), true)
       WHERE id = $1
       RETURNING data`,
      [id, JSON.stringify(totpSecret), totpEnabled, new Date().toISOString()],
    );
    return res.rows[0]?.data ?? null;
  }

  async listAllTechJobs(techId: string): Promise<Submission[]> {
    const res = await this.query(
      `SELECT data FROM submissions
       WHERE data#>>'{assignment,techId}' = $1
       ORDER BY COALESCE(data#>>'{assignment,claimedAt}', data->>'createdAt') DESC`,
      [techId],
    );
    return res.rows.map((r: any) => r.data);
  }

  // --- Duty sessions -------------------------------------------------------

  async openDutySession(session: DutySession): Promise<DutySession> {
    const existing = await this.query(
      "SELECT data FROM duty_sessions WHERE tech_id = $1 AND clock_out_at IS NULL LIMIT 1",
      [session.techId],
    );
    if (existing.rows[0]) return existing.rows[0].data;
    await this.query(
      `INSERT INTO duty_sessions (id, tech_id, clock_in_at, clock_out_at, data)
       VALUES ($1, $2, $3, NULL, $4)`,
      [session.id, session.techId, session.clockInAt, session],
    );
    return session;
  }

  async closeOpenDutySession(
    techId: string,
    clockOutAt: string,
  ): Promise<DutySession | null> {
    const res = await this.query(
      `UPDATE duty_sessions
         SET clock_out_at = $2,
             data = jsonb_set(data, '{clockOutAt}', to_jsonb($2::text), true)
       WHERE id = (
         SELECT id FROM duty_sessions
         WHERE tech_id = $1 AND clock_out_at IS NULL
         ORDER BY clock_in_at DESC LIMIT 1
       )
       RETURNING data`,
      [techId, clockOutAt],
    );
    return res.rows[0]?.data ?? null;
  }

  async listDutySessions(
    techId: string,
    sinceIso?: string,
  ): Promise<DutySession[]> {
    const res = await this.query(
      `SELECT data FROM duty_sessions
       WHERE tech_id = $1 AND ($2::timestamptz IS NULL OR clock_in_at >= $2)
       ORDER BY clock_in_at DESC`,
      [techId, sinceIso ?? null],
    );
    return res.rows.map((r: any) => r.data);
  }

  // --- Technician presence -------------------------------------------------

  async upsertPresence(presence: TechPresence): Promise<void> {
    await this.query(
      `INSERT INTO tech_presence (tech_id, data) VALUES ($1, $2)
       ON CONFLICT (tech_id) DO UPDATE SET data = EXCLUDED.data`,
      [presence.techId, presence],
    );
  }

  async listPresence(): Promise<TechPresence[]> {
    const res = await this.query("SELECT data FROM tech_presence");
    return res.rows.map((r: any) => r.data);
  }

  // --- Billing -------------------------------------------------------------

  async createCharge(charge: Charge): Promise<Charge> {
    await this.query(
      `INSERT INTO charges (id, submission_id, created_at, data)
       VALUES ($1, $2, $3, $4)`,
      [charge.id, charge.submissionId, charge.createdAt, charge],
    );
    return charge;
  }

  async listChargesForSubmission(submissionId: string): Promise<Charge[]> {
    const res = await this.query(
      "SELECT data FROM charges WHERE submission_id = $1 ORDER BY created_at ASC",
      [submissionId],
    );
    return res.rows.map((r: any) => r.data);
  }

  async listCharges(limit = 200): Promise<Charge[]> {
    const res = await this.query(
      "SELECT data FROM charges ORDER BY created_at DESC LIMIT $1",
      [limit],
    );
    return res.rows.map((r: any) => r.data);
  }

  async updateChargeStatus(
    id: string,
    status: ChargeStatus,
    providerRef?: string | null,
  ): Promise<Charge | null> {
    const res = await this.query(
      `UPDATE charges
         SET data = jsonb_set(
               jsonb_set(data, '{status}', to_jsonb($2::text), true),
               '{providerRef}', $3::jsonb, true)
       WHERE id = $1
       RETURNING data`,
      [id, status, JSON.stringify(providerRef ?? null)],
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
