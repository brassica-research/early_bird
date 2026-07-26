import { beforeEach } from "vitest";
import { resetData } from "./helpers";

// Give every test a clean, isolated data dir.
beforeEach(async () => {
  await resetData();
});
