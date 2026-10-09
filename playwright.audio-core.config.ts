import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./audio-tests",
  testMatch: "controller.spec.ts",
  workers: 3,
  timeout: 30_000,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "test-results/audio-core-results.json" }]],
  use: {
    baseURL: "http://127.0.0.1:4188",
    serviceWorkers: "block",
    // Protocol evaluation/trace snapshots can grant activation in Chromium.
    trace: "off",
  },
  projects: [
    {
      name: "chromium-gesture",
      use: {
        browserName: "chromium",
        launchOptions: { args: ["--autoplay-policy=user-gesture-required"] },
      },
    },
    {
      name: "chromium-strict",
      use: {
        browserName: "chromium",
        launchOptions: { args: ["--autoplay-policy=document-user-activation-required"] },
      },
    },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command:
      "npx vite --config vite.audio-core.config.ts --host 127.0.0.1 --port 4188 --strictPort",
    url: "http://127.0.0.1:4188",
    reuseExistingServer: false,
  },
});
