import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

// Shared by every visual spec. Animations are off, fonts are the system Noto CJK faces and every
// API response is mocked, so only real visual changes show up.

/** Removes the self-dismissing toast; see the file for why. */
export const pageStyle = fileURLToPath(new URL("./visual.css", import.meta.url));
/** Added for element captures, which scroll the page under the sticky top bar. */
export const elementStyle = fileURLToPath(new URL("./element.visual.css", import.meta.url));

// BRAGI_VISUAL_DELAY=7000 waits out every self-dismissing timer (toasts last six seconds) before
// each capture, to prove that no picture depends on how fast the run is.
const captureDelay = Number(process.env.BRAGI_VISUAL_DELAY ?? 0);

export async function settle(page: Page) {
  // Park the pointer outside the page so no hover state depends on where the last click landed.
  await page.mouse.move(-1, -1);
  if (captureDelay) await page.waitForTimeout(captureDelay);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() =>
    Promise.all(Array.from(document.images, (image) => image.decode().catch(() => undefined))),
  );
  // Keep the caret and focus rings out of the pictures.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}
