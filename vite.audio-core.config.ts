import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Test harness only; the application never imports this page or its mock adapter.
export default defineConfig({
  root: fileURLToPath(new URL("./audio-tests", import.meta.url)),
  server: { fs: { allow: [fileURLToPath(new URL(".", import.meta.url))] } },
});
