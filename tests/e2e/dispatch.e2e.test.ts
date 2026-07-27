import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { CookieJar } from "../helpers";

// ---------------------------------------------------------------------------
// End-to-end HTTP test across all three sides. Spawns the built Next server
// (requires `next build` first) and exercises the real cookie/middleware flow.
// ---------------------------------------------------------------------------

const PORT = 3199;
const BASE = `http://localhost:${PORT}`;
const DATA_DIR = path.resolve(process.cwd(), ".e2e-data");

let server: ChildProcess;
let serverOut = "";

async function waitForServer(timeoutMs = 60000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(BASE + "/");
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Server did not start in time.\n" + serverOut);
}

async function req(
  method: string,
  path: string,
  opts: { jar?: CookieJar; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    // Same-origin by default so CSRF guards pass.
    origin: BASE,
    ...(opts.headers ?? {}),
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.jar) headers["cookie"] = opts.jar.header();
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    redirect: "manual",
  });
  if (opts.jar) opts.jar.capture(res);
  return res;
}

beforeAll(async () => {
  await fs.rm(DATA_DIR, { recursive: true, force: true });
  await fs.mkdir(DATA_DIR, { recursive: true });
  for (const seed of ["heuristic-config.seed.json", "slots.seed.json"]) {
    await fs.copyFile(path.resolve("data", seed), path.join(DATA_DIR, seed));
  }
  server = spawn("node_modules/.bin/next", ["start", "-p", String(PORT)], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATA_DIR,
      GEOCODER: "none",
      TECH_PASSCODE: "invite123",
      ADMIN_PASSWORD: "hunter2",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (d) => (serverOut += d.toString()));
  server.stderr?.on("data", (d) => (serverOut += d.toString()));
  await waitForServer();
});

afterAll(async () => {
  server?.kill("SIGTERM");
  await fs.rm(DATA_DIR, { recursive: true, force: true });
});

describe("E2E — client → tech → admin", () => {
  const tech = new CookieJar();
  const admin = new CookieJar();
  let submissionId = "";

  it("registers a technician (invite-gated) and returns identity", async () => {
    const reg = await req("POST", "/api/tech/register", {
      jar: tech,
      body: { inviteCode: "invite123", name: "Alex Rivera", email: "alex@fix.co", password: "Zebra-Muffin-River-7" },
    });
    expect(reg.status).toBe(200);
    expect(tech.has("eb_tech")).toBe(true);

    const me = await req("GET", "/api/tech/me", { jar: tech });
    expect(me.status).toBe(200);
    expect((await me.json()).tech.name).toBe("Alex Rivera");
  });

  it("accepts a customer intake (client side)", async () => {
    const res = await req("POST", "/api/intake", {
      body: {
        name: "Pat Client", email: "pat@home.com", phone: "5551239876",
        address: "500 Oak St, Springfield IL", affectedServices: ["Leaky faucet"],
        description: "kitchen faucet leaking", clientUrgency: "high", smsOptIn: true,
      },
    });
    expect(res.status).toBe(201);
    submissionId = (await res.json()).submission.id;
    expect(submissionId).toBeTruthy();
  });

  it("shows the job in the tech queue and claims it atomically", async () => {
    const q = await req("GET", "/api/tech/queue", { jar: tech });
    expect(q.status).toBe(200);
    expect((await q.json()).queue.some((j: { id: string }) => j.id === submissionId)).toBe(true);

    const claim = await req("POST", "/api/tech/claim", { jar: tech, body: { submissionId } });
    expect(claim.status).toBe(200);

    const again = await req("POST", "/api/tech/claim", { jar: tech, body: { submissionId } });
    expect(again.status).toBe(409); // already claimed
  });

  it("commits an ETA and records a charge", async () => {
    const eta = await req("POST", "/api/tech/eta", { jar: tech, body: { submissionId, etaMinutes: 60 } });
    expect(eta.status).toBe(200);
    expect((await eta.json()).job.assignment.etaMinutes).toBe(60);

    const charge = await req("POST", "/api/tech/charge", {
      jar: tech, body: { submissionId, amountCents: 12500, description: "cartridge + labor" },
    });
    expect(charge.status).toBe(200);
  });

  it("reports presence and appears on the admin board (admin side)", async () => {
    const hb = await req("POST", "/api/tech/heartbeat", { jar: tech, body: { onDuty: true, lat: 39.8, lng: -89.64 } });
    expect(hb.status).toBe(200);

    await req("POST", "/api/admin/login", { jar: admin, body: { password: "hunter2" } });
    const board = await req("GET", "/api/admin/dispatch", { jar: admin });
    expect(board.status).toBe(200);
    const data = await board.json();
    expect(data.technicians.length).toBe(1);
    expect(data.technicians[0].assignments.length).toBe(1);
    expect(data.stats.onDuty).toBe(1);

    // Technician history: the heartbeat opened a duty session, and the job is
    // in the tech's job history.
    const techId = data.technicians[0].id;
    const hist = await req("GET", `/api/admin/technician?id=${techId}`, { jar: admin });
    expect(hist.status).toBe(200);
    const h = await hist.json();
    expect(h.dutySessions.length).toBeGreaterThanOrEqual(1);
    expect(h.jobs.some((j: { id: string }) => j.id === submissionId)).toBe(true);
  });

  it("enforces auth and CSRF", async () => {
    // No cookie → 401
    const unauth = await req("GET", "/api/tech/queue");
    expect(unauth.status).toBe(401);
    // Cross-origin mutation → 403
    const csrf = await req("POST", "/api/tech/claim", {
      jar: tech, body: { submissionId }, headers: { origin: "https://evil.example" },
    });
    expect(csrf.status).toBe(403);
  });

  it("runs the OWASP password-reset flow", async () => {
    const before = serverOut.length;
    const forgot = await req("POST", "/api/tech/forgot", { body: { email: "alex@fix.co" } });
    expect(forgot.status).toBe(200);

    // The reset link is logged by the console email transport (server stdout).
    await new Promise((r) => setTimeout(r, 500));
    const m = serverOut.slice(before).match(/tech\/reset\?token=([A-Za-z0-9_-]+)/);
    expect(m).toBeTruthy();
    const token = m![1];

    const reset = await req("POST", "/api/tech/reset", { body: { token, password: "New-Otter-Canyon-9" } });
    expect(reset.status).toBe(200);

    // Old password fails, new one works.
    const bad = await req("POST", "/api/tech/login", { body: { email: "alex@fix.co", password: "Zebra-Muffin-River-7" } });
    expect(bad.status).toBe(401);
    const good = await req("POST", "/api/tech/login", { jar: new CookieJar(), body: { email: "alex@fix.co", password: "New-Otter-Canyon-9" } });
    expect(good.status).toBe(200);
  });
});
