import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "mobile-chromium", testIgnore: "pwa.spec.ts", use: { ...devices["Pixel 7"] } },
    {
      name: "pwa-chromium",
      testMatch: "pwa.spec.ts",
      use: { ...devices["Pixel 7"], serviceWorkers: "allow" },
    },
  ],
  webServer: {
    command: "npm run build && node .output/server/index.mjs",
    env: { HOST: "127.0.0.1", PORT: "4173" },
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
  },
});
