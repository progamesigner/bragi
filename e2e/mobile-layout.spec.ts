import { expect, type Locator, type Page, test } from "@playwright/test";
import { mockAudio } from "./audio-fixture";
import {
  draftFile,
  goToStep,
  mockSignedInApi,
  openComparison,
  openSettings,
  openVoicePicker,
  recognize,
  selectImage,
} from "./fixtures";
import { pageStyle, settle } from "./visual-capture";

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  expect(value).not.toBeNull();
  if (!value) throw new Error("Expected a visible layout element");
  return value;
}
async function header(page: Page) {
  const root = page.locator("dialog[open]").last();
  const head = await box(root.locator(":scope > .sheet-panel > .sheet-header"));
  const title = await box(root.locator(":scope > .sheet-panel > .sheet-header h2"));
  const close = await box(root.locator(":scope > .sheet-panel > .sheet-header button"));
  expect(head.height).toBeLessThanOrEqual(73);
  expect(head.height).toBeGreaterThanOrEqual(60);
  expect(Math.abs(title.y + title.height / 2 - close.y - close.height / 2)).toBeLessThan(1);
  expect(head.y).toBeGreaterThanOrEqual((await box(root)).y);
}
async function snap(locator: Locator, name: string) {
  await settle(locator.page());
  await expect(locator).toHaveScreenshot(`${name}.png`, {
    animations: "disabled",
    stylePath: pageStyle,
    scale: "css",
  });
}
async function start(page: Page) {
  await mockSignedInApi(page);
  await mockAudio(page);
  await page.goto("/");
}

for (const colorScheme of ["dark", "light"] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme });
    for (const locale of ["zh-Hant", "zh-Hans", "ja", "ko", "en", "de", "es"]) {
      test(`settings ${locale}: single-line equal-height choices and aligned header`, async ({
        page,
      }) => {
        await page.addInitScript((value) => localStorage.setItem("bragi-locale", value), locale);
        await start(page);
        await page.locator(".top-nav-end button").click();
        await expect(page.locator("dialog[open]")).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await header(page);
        const choices = await page.locator("dialog[open] .choice span").evaluateAll((items) =>
          items.map((item) => {
            const range = document.createRange();
            range.selectNodeContents(item);
            return {
              lines: range.getClientRects().length,
              height: item.getBoundingClientRect().height,
              fits: item.scrollWidth <= item.clientWidth + 1,
            };
          }),
        );
        expect(choices.length).toBe(10);
        for (const choice of choices) {
          expect(choice.lines).toBe(1);
          expect(choice.height).toBeCloseTo(44, 1);
          expect(choice.fits).toBe(true);
        }
        const current = await box(page.locator("dialog[open] .voice-current"));
        const sample = await box(page.locator("dialog[open] .voice-row .voice-sample > button"));
        expect(sample.y).toBeGreaterThanOrEqual(current.y + current.height + 7);
        expect(Math.abs(sample.width - current.width)).toBeLessThan(1);
        const data = page.locator("dialog[open] .settings-section").last();
        const clear = await box(data.locator("button").first());
        const signOut = await box(data.locator("button").last());
        expect(signOut.y - clear.y - clear.height).toBeGreaterThanOrEqual(14);
        if (["zh-Hant", "ja"].includes(locale)) {
          await page.locator("dialog[open] > .sheet-panel > .sheet-body").evaluate((element) => {
            element.scrollTop = 0;
          });
          await snap(page.locator("dialog[open]"), `settings-${locale}-${colorScheme}`);
          await page.locator("dialog[open] > .sheet-panel > .sheet-body").evaluate((element) => {
            element.scrollTop = element.scrollHeight;
          });
          await header(page);
          await snap(page.locator("dialog[open]"), `settings-interface-${locale}-${colorScheme}`);
        }
      });
    }
    test("all sheets retain compact centered headers and image zoom targets", async ({ page }) => {
      await start(page);
      await recognize(page);
      await openComparison(page);
      await header(page);
      const tools = page.locator("dialog[open] .comparison-tools");
      const controls = await tools.locator("button, select").all();
      let before = 0;
      for (const control of controls) {
        const rect = await box(control);
        expect(rect.height).toBeGreaterThanOrEqual(44);
        expect(rect.x).toBeGreaterThanOrEqual(before);
        before = rect.x + rect.width;
      }
      await expect(tools.locator("label")).toHaveCount(0);
      await expect(tools.locator("select")).toHaveAccessibleName("圖片放大");
      await snap(tools, `comparison-tools-${colorScheme}`);
      await page.locator("dialog[open] > .sheet-panel > .sheet-header button").click();
      await page.getByRole("button", { name: "段落列表", exact: true }).click();
      await header(page);
      await page.locator("dialog[open] > .sheet-panel > .sheet-header button").click();
      await openSettings(page);
      await header(page);
      await openVoicePicker(page);
      await header(page);
      await page
        .locator("dialog[open]")
        .last()
        .locator(":scope > .sheet-panel > .sheet-header button")
        .click();
      await page.getByRole("button", { name: "清除目前內容", exact: true }).click();
      await header(page);
      await expect(page.locator("dialog[open]").last()).toContainText("清除");
    });
    test("one token-colored progress track; transport stays fixed across states", async ({
      page,
    }) => {
      await start(page);
      await recognize(page);
      await page.getByRole("button", { name: /^進入朗讀/ }).click();
      await page.evaluate(() => {
        window.audioTest.freezePosition = true;
        window.audioTest.holdStream = true;
      });
      const primary = page.locator(".playback-primary");
      const slider = page.locator(".playback-seek");
      const measure = () =>
        page.locator(".playback-transport").evaluate((element) =>
          [
            element,
            ...element.querySelectorAll(".playback-primary, .playback-secondary, .playback-seek"),
          ].map((item) => {
            const rect = item.getBoundingClientRect();
            return { y: rect.y, height: rect.height };
          }),
        );
      const initial = await measure();
      await expect(slider).toBeDisabled();
      await primary.click();
      await expect(page.locator(".playback")).toHaveAttribute("data-phase", "playing");
      await expect(slider).toBeDisabled();
      await expect.poll(measure).toEqual(initial);
      await primary.click();
      await expect(page.locator(".playback")).toHaveAttribute("data-phase", "paused");
      await page.evaluate(() => window.audioTest.closeStream?.());
      await expect(slider).toBeEnabled();
      await expect(page.locator(".playback progress")).toHaveCount(0);
      await expect(page.locator(".playback input[type=range]")).toHaveCount(1);
      expect(
        await slider.evaluate((el) => getComputedStyle(el).getPropertyValue("-webkit-appearance")),
      ).toBe("none");
      await expect.poll(measure).toEqual(initial);
      for (const control of await page
        .locator(".playback-secondary-button, .playback-segment-button")
        .all()) {
        expect((await box(control)).height).toBeGreaterThanOrEqual(44);
        expect(await control.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("solid");
      }
      const heading = await box(page.locator(".playback-position"));
      const legend = await box(page.locator(".playback-legend"));
      const segments = await box(page.locator(".playback-segments"));
      const tone = await box(page.locator(".playback-tone"));
      expect(legend.y - heading.y - heading.height).toBeGreaterThanOrEqual(11);
      expect(segments.y - legend.y - legend.height).toBeGreaterThanOrEqual(11);
      expect(tone.y - segments.y - segments.height).toBeGreaterThanOrEqual(11);
      await expect(page.locator(".playback").getByRole("button", { name: "返回校對" })).toHaveCount(
        0,
      );
      await snap(page.locator(".playback-transport"), `transport-paused-${colorScheme}`);
      await primary.click();
      await page.evaluate(() => window.audioTest.finish());
      await expect(page.locator(".playback")).toHaveAttribute("data-phase", "waiting");
      await expect.poll(measure).toEqual(initial);
      for (const height of [664, 844]) {
        await page.setViewportSize({ width: 390, height });
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const summary = await box(page.locator(".playback-settings-summary"));
        expect(height - summary.y - summary.height).toBeLessThanOrEqual(28);
      }
    });
    test("review language, compact dirty hint and actual footer reservation", async ({ page }) => {
      await start(page);
      await page.locator("#draft-import").setInputFiles({
        ...draftFile("韓文內容"),
        buffer: Buffer.from(
          JSON.stringify({
            format: "bragi-draft",
            version: 1,
            exportedAt: "2026-10-09T00:00:00Z",
            detectedLanguage: "ko",
            segments: [
              { id: "one", text: "안녕하세요", suggestedToneHint: "平靜" },
              { id: "two", text: "안녕하세요", suggestedToneHint: "平靜" },
            ],
          }),
        ),
      });
      await expect(page.locator(".review-heading")).toContainText("韓文");
      await page.getByLabel("口白文字", { exact: true }).first().fill("안녕하세요!");
      await expect(page.locator(".draft-dirty")).toBeVisible();
      expect((await box(page.locator(".draft-dirty"))).height).toBeLessThan(30);
      await expect(page.locator("#draft-save-detail")).toHaveClass("visually-hidden");
      await expect(page.locator(".draft-dirty")).toHaveAttribute(
        "aria-describedby",
        "draft-save-detail",
      );
      for (const height of [664, 844]) {
        await page.setViewportSize({ width: 390, height });
        await page.evaluate(() => {
          (document.activeElement as HTMLElement)?.blur();
          window.scrollTo(0, document.documentElement.scrollHeight);
        });
        const last = await box(page.locator(".review-segment").last());
        const footer = await box(page.locator(".review-footer"));
        const gap = footer.y - last.y - last.height;
        expect(gap).toBeGreaterThanOrEqual(12);
        expect(gap).toBeLessThanOrEqual(60);
      }
      await goToStep(page, "取圖");
      await page.locator("#draft-import").setInputFiles({
        ...draftFile("未知語言"),
        buffer: Buffer.from(
          JSON.stringify({
            format: "bragi-draft",
            version: 1,
            exportedAt: "2026-10-09T00:00:00Z",
            detectedLanguage: "x-unknown",
            segments: [{ id: "one", text: "hello", suggestedToneHint: "平靜" }],
          }),
        ),
      });
      await page.getByRole("button", { name: "不匯出，直接匯入" }).click();
      await expect(page.locator(".review-heading")).toContainText("x-unknown");
    });
    test("capture candidate grouping, collapsed disclosures and bottom space", async ({ page }) => {
      await start(page);
      await selectImage(page);
      await expect(page.locator(".candidate-heading button")).toHaveText("取消候選圖片");
      const heading = await box(page.locator(".candidate-heading"));
      const cancel = await box(page.locator(".candidate-heading button"));
      expect(Math.abs(heading.y + heading.height / 2 - cancel.y - cancel.height / 2)).toBeLessThan(
        1,
      );
      await snap(page.locator(".candidate-panel"), `candidate-${colorScheme}`);
      for (const selector of [".privacy-note", ".capture-preview-details"]) {
        const details = page.locator(selector);
        await details.locator("summary").click();
        await expect(details).not.toHaveAttribute("open", "");
        expect(
          (await box(details)).height - (await box(details.locator("summary"))).height,
        ).toBeLessThanOrEqual(3);
      }
      for (const height of [664, 844]) {
        await page.setViewportSize({ width: 390, height });
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const result = await page.locator(".capture-privacy").evaluate((el) => ({
          bottom: el.getBoundingClientRect().bottom + window.scrollY,
          document: document.documentElement.scrollHeight,
        }));
        expect(result.document - result.bottom).toBeLessThanOrEqual(32);
      }
      await page.locator(".candidate-heading button").click();
      await expect(page.locator(".candidate-panel")).toBeHidden();
    });
  });
}
