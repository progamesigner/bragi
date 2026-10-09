import { expect, type Page, test } from "@playwright/test";
import de from "../src/lib/i18n/messages/de";
import en from "../src/lib/i18n/messages/en";
import es from "../src/lib/i18n/messages/es";
import ja from "../src/lib/i18n/messages/ja";
import ko from "../src/lib/i18n/messages/ko";
import zhHans from "../src/lib/i18n/messages/zh-Hans";
import zhHant from "../src/lib/i18n/messages/zh-Hant";
import { mockAudio } from "./audio-fixture";
import { image, mockSignedInApi } from "./fixtures";

// Translations change string lengths a lot (German most of all). Every control on the capture,
// review, settings, reading and finish screens must fit the phone width without pushing the page sideways or
// clipping its label.

/** Describes controls whose label is wider than the control, and the page's sideways overflow. */
function layoutProblems(page: Page, scope: string) {
  return page.evaluate((scope) => {
    const root = document.querySelector(scope) ?? document.body;
    const problems: string[] = [];
    const page = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    if (page > 0) problems.push(`page scrolls sideways by ${page}px`);
    const controls = root.querySelectorAll<HTMLElement>(
      "button, a, label, summary, [role=radio], [role=tab], .button",
    );
    for (const control of controls) {
      if (!control.checkVisibility()) continue;
      const box = control.getBoundingClientRect();
      const name = (control.textContent || control.getAttribute("aria-label") || "").trim();
      if (control.scrollWidth > control.clientWidth + 1)
        problems.push(`"${name}" is ${control.scrollWidth - control.clientWidth}px too narrow`);
      if (box.right > document.documentElement.clientWidth + 0.5 || box.left < -0.5)
        problems.push(`"${name}" leaves the screen`);
      for (const part of [control, ...control.querySelectorAll<HTMLElement>("*")]) {
        const style = getComputedStyle(part);
        if (style.textOverflow === "ellipsis" && part.scrollWidth > part.clientWidth + 1)
          problems.push(`"${name}" is cut off with an ellipsis`);
      }
    }
    return problems;
  }, scope);
}

for (const [locale, dictionary] of Object.entries({
  "zh-Hant": zhHant,
  "zh-Hans": zhHans,
  ja,
  ko,
  en,
  de,
  es,
})) {
  for (const width of [390, 320]) {
    test(`${locale} at ${width}px fits every screen without clipping`, async ({ page }) => {
      await page.addInitScript((value) => localStorage.setItem("bragi-locale", value), locale);
      await page.setViewportSize({ width, height: 844 });
      await mockSignedInApi(page);
      await mockAudio(page);
      await page.goto("/");
      await expect(page.locator("#capture-heading")).toHaveText(dictionary["capture.heading"]);
      await page.evaluate(() => document.fonts.ready);
      expect(await layoutProblems(page, "body"), "capture").toEqual([]);

      await page
        .locator("#library-input")
        .setInputFiles({ name: "card.png", mimeType: "image/png", buffer: image });
      const start = page.getByRole("button", { name: dictionary["recognize.start"], exact: true });
      await expect(start).toBeEnabled();
      expect(await layoutProblems(page, "body"), "capture with an image").toEqual([]);

      await start.click();
      await expect(page.locator("#review-heading")).toHaveText(dictionary["review.heading"]);
      expect(await layoutProblems(page, "body"), "review").toEqual([]);
      for (const details of await page.locator("#main details:not([open]) > summary").all())
        await details.click();
      expect(await layoutProblems(page, "body"), "review with every section open").toEqual([]);

      await page.getByRole("button", { name: dictionary["settings.open"], exact: true }).click();
      const settings = page.getByRole("dialog", { name: dictionary["settings.title"] });
      await expect(settings).toBeVisible();
      expect(await layoutProblems(page, "dialog[open]"), "settings").toEqual([]);
      await settings.getByRole("button", { name: dictionary["settings.close"] }).click();
      await expect(settings).toBeHidden();

      // Reading: idle on the first part, then playing and waiting on the last one, then complete.
      await page.locator(".review-footer button").click();
      const reading = page.locator(".playback");
      await expect(reading).toBeVisible();
      expect(await layoutProblems(page, "body"), "reading").toEqual([]);
      await page.getByRole("button", { name: dictionary["playback.next"], exact: true }).click();
      await page.locator(".playback-primary").click();
      await expect(reading).toHaveAttribute("data-phase", "playing");
      expect(await layoutProblems(page, "body"), "reading while playing").toEqual([]);
      await page.evaluate(() => window.audioTest.finish());
      await expect(reading).toHaveAttribute("data-phase", "complete");
      expect(await layoutProblems(page, "body"), "reading complete").toEqual([]);

      await page.locator(".playback-primary").click();
      await expect(page).toHaveURL(/\/finished$/);
      await expect(
        page.getByRole("heading", { name: dictionary["finished.heading"] }),
      ).toBeVisible();
      expect(await layoutProblems(page, "body"), "finished").toEqual([]);
    });
  }
}

test("the layout check notices a clipped label", async ({ page }) => {
  await mockSignedInApi(page);
  await page.goto("/");
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.textContent = "Entwurf importieren und fortfahren";
    button.style.cssText = "width:44px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
    document.querySelector("#main")?.append(button);
  });
  const problems = await layoutProblems(page, "body");
  expect(problems.some((problem) => problem.includes("too narrow"))).toBe(true);
  expect(problems.some((problem) => problem.includes("ellipsis"))).toBe(true);
});
