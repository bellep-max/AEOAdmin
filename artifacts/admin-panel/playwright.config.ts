import { defineConfig, devices } from "@playwright/test";

/**
 * E2E runs against the Vite dev server with ALL network mocked in-spec
 * (auth, data, and the LLM proxy), so no backend or DeepSeek key is needed.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 120_000,
    env: { PORT: "5173", VITE_API_URL: "" },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
