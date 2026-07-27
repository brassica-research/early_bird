import { promises as fs } from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Test helpers.
// ---------------------------------------------------------------------------

const DATA_DIR = path.resolve(process.env.DATA_DIR || ".test-data");
const REPO_DATA = path.resolve(__dirname, "../data");

const RUNTIME_FILES = [
  "submissions.json",
  "feedback.json",
  "slots.json",
  "charges.json",
  "tech-accounts.json",
  "reset-tokens.json",
  "tech-presence.json",
  "heuristic-config.live.json",
];

/**
 * Reset the isolated data dir to a clean state: seed files present, runtime
 * files removed, and the cached store singleton cleared so init re-runs.
 */
export async function resetData(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  // Copy the tracked seed files so the store can seed from them.
  for (const seed of ["heuristic-config.seed.json", "slots.seed.json"]) {
    await fs.copyFile(
      path.join(REPO_DATA, seed),
      path.join(DATA_DIR, seed),
    );
  }
  // Remove any runtime files from a prior test.
  for (const f of RUNTIME_FILES) {
    await fs.rm(path.join(DATA_DIR, f), { force: true });
  }
  // Clear the cached store + its init promise so the next call re-initializes.
  const g = globalThis as unknown as {
    __earlyBirdStore?: unknown;
    __earlyBirdStoreInit?: unknown;
  };
  delete g.__earlyBirdStore;
  delete g.__earlyBirdStoreInit;
}

/** Read a runtime JSON file from the test data dir (or fallback). */
export async function readData<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, file), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// --- Minimal cookie jar for the E2E HTTP flow ------------------------------

export class CookieJar {
  private cookies = new Map<string, string>();

  capture(res: Response): void {
    // undici exposes getSetCookie(); fall back to a single header otherwise.
    const list =
      (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ??
      (res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);
    for (const c of list) {
      const [pair] = c.split(";");
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === "" ) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  header(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  has(name: string): boolean {
    return this.cookies.has(name);
  }
}
