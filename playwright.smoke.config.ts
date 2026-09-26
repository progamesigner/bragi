import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.BRAGI_SMOKE_URL;
if (!baseURL || new URL(baseURL).protocol !== "https:") {
  throw new Error("Set BRAGI_SMOKE_URL to the HTTPS deployment to check");
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "smoke.spec.ts",
  retries: 0,
  reporter: "list",
  use: { ...devices["Pixel 7"], baseURL, serviceWorkers: "block", trace: "off" },
});
