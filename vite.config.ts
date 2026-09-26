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
          alias: {
            "server-only": fileURLToPath(new URL("./test/server-only.ts", import.meta.url)),
            "~": fileURLToPath(new URL("./src", import.meta.url)),
          },
        }
      : undefined,
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
}));
