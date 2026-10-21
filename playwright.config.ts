import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;

// Playwright evaluates this config in the runner AND again in every worker
// process. A directory derived from pid/Date.now() therefore produces a DIFFERENT
// value for the dev server than for the tests that seed state out-of-process --
// the fixture lands in one SQLite file and the API reads an empty other one.
// A stable path derived only from cwd keeps both sides on the same database.
const dataDirectory = process.env.NEWBEING_E2E_DATA_DIR
  ?? join(process.cwd(), ".newbeing", "e2e-run");
process.env.NEWBEING_E2E_DATA_DIR = dataDirectory;
// Only reset when this process owns the run (the runner sets the marker); workers
// must never wipe the database the server is already using.
const ownsDatabase = process.env.NEWBEING_E2E_OWNER !== "1";
process.env.NEWBEING_E2E_OWNER = "1";
if (ownsDatabase && !externalBaseURL) {
  rmSync(dataDirectory, { recursive: true, force: true });
}
mkdirSync(dataDirectory, { recursive: true });
if (externalBaseURL) {
  const hostname = new URL(externalBaseURL).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
    throw new Error("PLAYWRIGHT_BASE_URL must point to a loopback host.");
  }
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  timeout: 120_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: externalBaseURL ?? "http://127.0.0.1:3100",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 1200 },
    headless: true,
    navigationTimeout: 120_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: externalBaseURL ? undefined : {
    command: "pnpm --filter @newbeing/web dev --webpack",
    url: "http://127.0.0.1:3100/api/strategies",
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: "3100",
      NEWBEING_NEXT_DIST_DIR: ".next-e2e",
      NEWBEING_E2E_FIXTURES: "1",
      NEWBEING_DATA_DIR: dataDirectory,
    },
  },
});
