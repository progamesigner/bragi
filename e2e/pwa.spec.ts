import { expect, test } from "@playwright/test";

test("installs a worker that caches only public assets and provides an offline page", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const manifest = await page.request.get("/manifest.webmanifest");
  expect(await manifest.json()).toMatchObject({ display: "standalone", start_url: "/" });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.evaluate(async () => {
    await fetch("/api/health");
  });
  const urls = await page.evaluate(async () => {
    const names = await caches.keys();
    return (
      await Promise.all(
        names.map(async (name) =>
          (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname),
        ),
      )
    ).flat();
  });
  expect(urls).toContain("/offline.html");
  expect(
    urls.every(
      (url) =>
        url.startsWith("/_build/") ||
        ["/offline.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"].includes(url),
    ),
  ).toBe(true);
  expect(urls).not.toContain("/");
  await context.setOffline(true);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Bragi 目前離線" })).toBeVisible();
});
