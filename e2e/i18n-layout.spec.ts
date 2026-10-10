import { expect, type Page, test } from "@playwright/test";
import { format } from "../src/lib/i18n";
import de from "../src/lib/i18n/messages/de";
import en from "../src/lib/i18n/messages/en";
import es from "../src/lib/i18n/messages/es";
import ja from "../src/lib/i18n/messages/ja";
import ko from "../src/lib/i18n/messages/ko";
import zhHans from "../src/lib/i18n/messages/zh-Hans";
import zhHant from "../src/lib/i18n/messages/zh-Hant";
import { VOICE_CATALOG } from "../src/lib/voices";
import { mockAudio } from "./audio-fixture";
import { image, mockSignedInApi } from "./fixtures";

const VOICES = VOICE_CATALOG.map(([name]) => name);

// Translations change string lengths a lot (German most of all). Every control on the capture,
// review, settings, voice picker, reading and finish screens, and the top bar with its wordmark,
// must fit the phone width without pushing the page sideways, clipping or overlapping.

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
        if (part.classList.contains("segment-excerpt")) continue;
        const style = getComputedStyle(part);
        if (style.textOverflow === "ellipsis" && part.scrollWidth > part.clientWidth + 1)
          problems.push(`"${name}" is cut off with an ellipsis`);
      }
    }
    // The top bar: the wordmark or "previous page", the steps and settings sit side by side, none
    // wider than its column and none drawn over its neighbour.
    const nav = root.querySelector(".top-nav");
    let before: { name: string; right: number } | undefined;
    for (const name of ["start", "steps", "end"]) {
      const column = nav?.querySelector<HTMLElement>(
        name === "steps" ? ".steps" : `.top-nav-${name}`,
      );
      if (!column) continue;
      if (column.scrollWidth > column.clientWidth + 1)
        problems.push(
          `top bar ${name} is ${column.scrollWidth - column.clientWidth}px wider than its column`,
        );
      const boxes = Array.from(column.querySelectorAll<Element>("*"))
        .filter((part) => !part.closest(".visually-hidden") && part.checkVisibility())
        .map((part) => part.getBoundingClientRect())
        .filter((box) => box.width > 1);
      if (!boxes.length) continue;
      const left = Math.min(...boxes.map((box) => box.left));
      if (before && left < before.right - 0.5)
        problems.push(`top bar ${name} overlaps ${before.name} by ${before.right - left}px`);
      before = { name, right: Math.max(...boxes.map((box) => box.right)) };
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
      await page.route("**/api/session", (route) =>
        route.fulfill({
          json: {
            authenticated: true,
            voices: ["Kore", ...VOICES.filter((name) => name !== "Kore")],
          },
        }),
      );
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
      expect(await layoutProblems(page, "body"), "review compact").toEqual([]);

      const firstSegment = page.locator(".review-segment").first();
      await firstSegment
        .getByRole("button", { name: dictionary["review.moreEditing"], exact: true })
        .click();
      const addSpoken = firstSegment.getByRole("button", {
        name: dictionary["review.addSpoken"],
        exact: true,
      });
      if (await addSpoken.count()) await addSpoken.click();
      for (const details of await page.locator("#main details:not([open]) > summary").all())
        await details.click();
      expect(await layoutProblems(page, "body"), "review expanded").toEqual([]);

      await page
        .getByRole("button", { name: dictionary["review.segmentList"], exact: true })
        .click();
      const listSheet = page.getByRole("dialog", { name: dictionary["review.segmentList"] });
      await expect(listSheet).toBeVisible();
      expect(await layoutProblems(page, "dialog[open]"), "review segment list sheet").toEqual([]);
      await listSheet.getByRole("button", { name: dictionary["review.closeList"] }).click();
      await expect(listSheet).toBeHidden();

      await page.getByRole("button", { name: dictionary["review.compare"], exact: true }).click();
      const imageSheet = page.getByRole("dialog", { name: dictionary["review.compare"] });
      await expect(imageSheet).toBeVisible();
      expect(await layoutProblems(page, "dialog[open]"), "review image comparison sheet").toEqual(
        [],
      );
      await imageSheet.getByRole("button", { name: dictionary["review.closeImage"] }).click();
      await expect(imageSheet).toBeHidden();

      await page.getByRole("button", { name: dictionary["settings.open"], exact: true }).click();
      const settings = page.getByRole("dialog", { name: dictionary["settings.title"] });
      await expect(settings).toBeVisible();
      expect(await layoutProblems(page, "dialog[open]"), "settings").toEqual([]);

      // The voice picker on top of settings, with the full catalog, one trait filtered and a preview.
      await settings.locator(".voice-current").click();
      const picker = page.getByRole("dialog", { name: dictionary["voicePicker.title"] });
      await expect(picker).toBeVisible();
      await expect(picker.getByRole("radio")).toHaveCount(VOICE_CATALOG.length);
      expect(await layoutProblems(page, ".voice-picker-sheet"), "voice picker").toEqual([]);
      await picker.getByLabel(dictionary["voicePicker.trait"]).selectOption("firm");
      await picker
        .getByRole("button", {
          name: format(dictionary["voicePicker.action"], {
            action: dictionary["voicePicker.preview"],
            voice: "Alnilam",
          }),
        })
        .click();
      await expect(picker.locator(".voice-sample-compact[data-phase=playing]")).toHaveCount(1);
      expect(await layoutProblems(page, ".voice-picker-sheet"), "voice picker preview").toEqual([]);
      await picker.getByRole("button", { name: dictionary["voicePicker.close"] }).click();
      await expect(picker).toBeHidden();
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

test("the layout check notices a crowded top bar", async ({ page }) => {
  // German at 320px with the old evenly shrinking columns drew the wordmark under "Erfassen".
  await page.addInitScript(() => localStorage.setItem("bragi-locale", "de"));
  await page.setViewportSize({ width: 320, height: 844 });
  await mockSignedInApi(page);
  await page.goto("/");
  await page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>(".top-nav");
    if (nav) {
      nav.style.gridTemplateColumns = "minmax(0, 1fr) auto minmax(0, 1fr)";
      nav.style.gap = "4px";
      nav.style.paddingInline = "8px";
    }
  });
  const problems = await layoutProblems(page, "body");
  expect(problems.some((problem) => problem.includes("top bar start is"))).toBe(true);
  expect(problems.some((problem) => problem.includes("top bar steps overlaps start"))).toBe(true);
});
