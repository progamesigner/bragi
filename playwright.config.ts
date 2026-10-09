import { defineConfig, devices } from "@playwright/test";

const port = process.env.BRAGI_E2E_PORT ?? "4173";
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: {
    baseURL,
    locale: "zh-TW",
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  expect: {
    // Allows for anti-aliasing differences between machines, not for layout or colour changes.
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
  },
  projects: [
    {
      name: "mobile-chromium",
      testIgnore: ["pwa.spec.ts", "visual.spec.ts"],
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "visual-phone",
      testMatch: "visual.spec.ts",
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
        locale: "zh-TW",
        timezoneId: "Asia/Taipei",
      },
    },
    {
      name: "visual-tablet",
      testMatch: "visual.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1180, height: 820 },
        deviceScaleFactor: 1,
        hasTouch: true,
        reducedMotion: "reduce",
        locale: "zh-TW",
        timezoneId: "Asia/Taipei",
      },
    },
    {
      name: "pwa-chromium",
      testMatch: "pwa.spec.ts",
      use: { ...devices["Pixel 7"], serviceWorkers: "allow" },
    },
  ],
  webServer: {
    command: "npm run build && node .output/server/index.mjs",
    env: { HOST: "127.0.0.1", PORT: port },
    url: baseURL,
    reuseExistingServer: false,
  },
});
