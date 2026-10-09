// Renders the PWA icons and favicons in public/ from the SVG sources in assets/icon/.
// Replace assets/icon/icon.svg (and icon-maskable.svg) and run `node scripts/build-icons.mjs`.
// Rendering uses the Chromium that Playwright already installs for the E2E tests.
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { ICONS } from "./pwa-assets.mjs";

const source = new URL("../assets/icon/", import.meta.url);
const target = new URL("../public/", import.meta.url);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const icon of ICONS) {
    if (!icon.size) {
      await copyFile(new URL(icon.source, source), new URL(icon.output, target));
      continue;
    }
    const svg = (await readFile(new URL(icon.source, source))).toString("base64");
    await page.setViewportSize({ width: icon.size, height: icon.size });
    await page.setContent(
      `<body style="margin:0"><img src="data:image/svg+xml;base64,${svg}" width="${icon.size}" height="${icon.size}" style="display:block"></body>`,
    );
    await page.locator("img").evaluate((image) => image.decode());
    await writeFile(new URL(icon.output, target), await page.screenshot({ omitBackground: true }));
    console.log(`public/${icon.output} (${icon.size}×${icon.size})`);
  }
} finally {
  await browser.close();
}
