import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export default function pwaBuild() {
  return {
    name: "bragi-pwa",
    applyToEnvironment(environment) {
      return environment.name === "client";
    },
    async writeBundle(options) {
      if (!options.dir) throw new Error("PWA build requires a directory output");
      const root = pathToFileURL(`${resolve(options.dir)}/`);
      const assets = ["/offline.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];
      async function walk(path) {
        for (const entry of await readdir(new URL(path, root), { withFileTypes: true })) {
          const child = `${path}${entry.name}`;
          if (entry.isDirectory()) await walk(`${child}/`);
          else if (/\.(js|css)$/.test(child)) assets.push(`/${child}`);
        }
      }
      await walk("_build/");
      assets.sort();
      const hash = createHash("sha256");
      for (const path of assets)
        hash.update(
          await readFile(
            path.startsWith("/_build/")
              ? new URL(path.slice(1), root)
              : new URL(`../public${path}`, import.meta.url),
          ),
        );
      const version = hash.digest("hex").slice(0, 16);
      await writeFile(
        new URL("sw.js", root),
        `
const CACHE = "bragi-shell-${version}";
const ASSETS = ${JSON.stringify(assets)};
self.addEventListener("install", event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  for (const path of ASSETS) {
    const response = await fetch(path, {credentials: "omit", cache: "reload"});
    if (!response.ok) throw new Error("Shell asset unavailable");
    await cache.put(path, response);
  }
})()));
self.addEventListener("activate", event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith("bragi-shell-") && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener("message", event => {
  if (event.data === "ACTIVATE_UPDATE") event.waitUntil((async () => {
    const clients = await self.clients.matchAll({type: "window", includeUncontrolled: true});
    if (clients.length > 1) { event.source?.postMessage("CLOSE_OTHER_TABS"); return; }
    await self.skipWaiting();
  })());
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.search || url.pathname.startsWith("/api/")) return;
  if (ASSETS.includes(url.pathname)) event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(url.pathname)) || fetch(event.request)));
  else if (event.request.mode === "navigate" && url.pathname === "/") event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then(cache => cache.match("/offline.html"))));
});
`,
      );
    },
  };
}
