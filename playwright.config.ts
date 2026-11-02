import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_TMP = path.resolve(__dirname, ".tmp");

// Ensure TMPDIR points to workspace disk to prevent /tmp (512MB tmpfs) exhaustion
process.env.TMPDIR = WORKSPACE_TMP;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.e2e.ts",
  outputDir: path.resolve(WORKSPACE_TMP, "test-results"),
  reporter: [
    ["list"],
    ["html", { outputFolder: path.resolve(WORKSPACE_TMP, "playwright-report"), open: "never" }],
  ],
  webServer: {
    command: "npm run preview",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 120000,
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1440, height: 900 },
    video: "retain-on-failure",
    trace: "on-first-retry",
    launchOptions: {
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
