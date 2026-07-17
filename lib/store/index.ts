import type { Store } from "./types";
import { JsonFileStore } from "./jsonFileStore";
import { PostgresStore } from "./postgresStore";

export type { Store, HeuristicConfig } from "./types";

// ---------------------------------------------------------------------------
// Store factory + process-wide singleton.
//
// The ONLY place STORE_DRIVER is read. Flip the env var to change the backend;
// nothing else in the codebase imports a concrete driver.
//
//   STORE_DRIVER=json      -> local JSON files (default)
//   STORE_DRIVER=postgres  -> hosted Postgres (see postgresStore.ts)
// ---------------------------------------------------------------------------

function createStore(): Store {
  const driver = (process.env.STORE_DRIVER || "json").toLowerCase();
  switch (driver) {
    case "postgres":
    case "pg":
      return new PostgresStore();
    case "json":
    case "":
      return new JsonFileStore();
    default:
      throw new Error(
        `Unknown STORE_DRIVER "${driver}". Use "json" or "postgres".`,
      );
  }
}

// Cache the store (and its init) on the global object so Next.js hot-reload in
// dev doesn't create a new instance (and re-run init) on every request.
const globalForStore = globalThis as unknown as {
  __earlyBirdStore?: Store;
  __earlyBirdStoreInit?: Promise<void>;
};

export function getStore(): Store {
  if (!globalForStore.__earlyBirdStore) {
    globalForStore.__earlyBirdStore = createStore();
  }
  return globalForStore.__earlyBirdStore;
}

/** Returns an initialized store. Safe to call on every request (init runs once). */
export async function getInitializedStore(): Promise<Store> {
  const store = getStore();
  if (!globalForStore.__earlyBirdStoreInit) {
    globalForStore.__earlyBirdStoreInit = store.init();
  }
  await globalForStore.__earlyBirdStoreInit;
  return store;
}
