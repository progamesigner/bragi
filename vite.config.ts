import { fileURLToPath } from "node:url";
import { solidStart } from "@solidjs/start/config";
import { nitro } from "nitro/vite";
import { defineConfig } from "vitest/config";
import pwaBuild from "./scripts/build-worker.mjs";

export default defineConfig(({ mode }) => ({
  plugins: mode === "test" ? [] : [solidStart({ ssr: false }), pwaBuild(), nitro()],
  resolve:
    mode === "test"
      ? {
          alias: [
            {
              find: "server-only",
              replacement: fileURLToPath(new URL("./test/server-only.ts", import.meta.url)),
            },
            { find: "~", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
            // Node would load Solid's server build, whose stores and effects are inert; the client
            // stores are tested with the build browsers run.
            {
              find: /^solid-js$/,
              replacement: fileURLToPath(
                new URL("./node_modules/solid-js/dist/solid.js", import.meta.url),
              ),
            },
            {
              find: /^solid-js\/store$/,
              replacement: fileURLToPath(
                new URL("./node_modules/solid-js/store/dist/store.js", import.meta.url),
              ),
            },
          ],
        }
      : undefined,
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
}));
