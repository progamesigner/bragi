import { expect, test } from "@playwright/test";
import { PRECACHED_PUBLIC_ASSETS } from "../scripts/pwa-assets.mjs";

test("installs a worker that caches only public assets and provides an offline page", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const manifest = await page.request.get("/manifest.webmanifest");
  expect(await manifest.json()).toMatchObject({
    display: "standalone",
    start_url: "/",
    theme_color: "#171512",
    background_color: "#171512",
    description: expect.any(String),
    categories: expect.arrayContaining(["games"]),
  });
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
    urls.every((url) => url.startsWith("/_build/") || PRECACHED_PUBLIC_ASSETS.includes(url)),
  ).toBe(true);
  expect(urls).toEqual(expect.arrayContaining([...PRECACHED_PUBLIC_ASSETS]));
  expect(urls).not.toContain("/");
  await context.setOffline(true);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Bragi 目前離線" })).toBeVisible();
});

test("the manifest makes Bragi installable with separate any and maskable icons", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  const cdp = await page.context().newCDPSession(page);
  const { errors, data } = await cdp.send("Page.getAppManifest");
  expect(errors).toEqual([]);
  const manifest = JSON.parse(data ?? "{}") as {
    icons: { src: string; sizes: string; purpose: string }[];
  };
  for (const purpose of ["any", "maskable"])
    for (const sizes of ["192x192", "512x512"])
      expect(manifest.icons).toContainEqual(expect.objectContaining({ purpose, sizes }));
  for (const icon of manifest.icons) expect((await page.request.get(icon.src)).ok()).toBe(true);
  await expect
    .poll(async () => (await cdp.send("Page.getInstallabilityErrors")).installabilityErrors)
    .toEqual([]);
  for (const link of ['link[rel="apple-touch-icon"]', 'link[rel="icon"][type="image/svg+xml"]']) {
    const href = await page.locator(link).getAttribute("href");
    expect((await page.request.get(href ?? "")).ok()).toBe(true);
  }
});

test("the offline page follows the saved theme and language", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("bragi-theme", "light");
    localStorage.setItem("bragi-locale", "de");
  });
  await page.goto("/offline.html");
  await expect(page.getByRole("heading", { name: "Bragi ist offline" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#f6f1e7");
});
