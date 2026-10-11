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
import {
  controls,
  expectFootOfLongScript,
  expectOneMessagePlace,
  holdToasts,
  longScript,
} from "./playback-toast";
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
/** Pixels in a screenshot that read as blue; the warm palettes never draw any. */
async function bluePixels(locator: Locator) {
  const png = await locator.screenshot({ animations: "disabled" });
  return locator.page().evaluate(async (data) => {
    const picture = new Image();
    picture.src = `data:image/png;base64,${data}`;
    await picture.decode();
    const canvas = document.createElement("canvas");
    canvas.width = picture.width;
    canvas.height = picture.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No canvas");
    context.drawImage(picture, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const [red = 0, green = 0, blue = 0] = pixels.subarray(index, index + 3);
      if (blue > red + 40 && blue > green + 20) count++;
    }
    return count;
  }, png.toString("base64"));
}
/** Native controls on the page that would draw in the platform's colours instead of the theme's. */
function nativeControls(page: Page) {
  return page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--accent)";
    document.body.append(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    const problems: string[] = [];
    if (document.querySelector("progress, meter")) problems.push("native progress or meter");
    for (const input of document.querySelectorAll<HTMLInputElement>(
      "input[type=range], input[type=radio], input[type=checkbox]",
    )) {
      const style = getComputedStyle(input);
      const hidden = style.opacity === "0";
      const drawn = style.getPropertyValue("-webkit-appearance") === "none";
      if (input.type === "range" && !drawn) problems.push(`native range ${input.className}`);
      if (input.type === "range" && !input.classList.contains("seek"))
        problems.push(`range without the shared seek style ${input.className}`);
      if (!hidden && !drawn && style.accentColor !== accent)
        problems.push(`${input.type} accent ${style.accentColor}`);
    }
    return problems;
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
            ...element.querySelectorAll(
              ".playback-meter, .playback-primary, .playback-secondary, .playback-seek",
            ),
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
        // No room is kept for messages: the secondary buttons end the page.
        const secondary = await box(page.locator(".playback-secondary"));
        expect(height - secondary.y - secondary.height).toBeLessThanOrEqual(28);
      }
    });
    for (const [width, height] of [
      [390, 844],
      [320, 640],
    ] as const)
      test(`reading messages float in one place over the script at ${width}px`, async ({
        page,
      }) => {
        // Walks through every playback state; WebKit under a full parallel run needs the time.
        test.slow();
        await page.setViewportSize({ width, height });
        await holdToasts(page);
        await start(page);
        await recognize(page);
        await page.getByRole("button", { name: /^進入朗讀/ }).click();
        await expect(page.locator(".playback")).toHaveAttribute("data-phase", "idle");
        await page.evaluate(() => document.fonts.ready);
        const [transport, , , , secondary] = await controls(page);
        expect(
          (transport?.y ?? 0) +
            (transport?.height ?? 0) -
            (secondary?.y ?? 0) -
            (secondary?.height ?? 0),
        ).toBeLessThanOrEqual(1);
        const places = await expectOneMessagePlace(page);
        // Over the end of the script, never above where it starts.
        const script = await box(page.locator(".playback-script"));
        for (const { label, rect } of places) {
          expect(rect.y + rect.height, label).toBeGreaterThan(script.y);
          expect(rect.y, label).toBeGreaterThanOrEqual(script.y - 1);
        }
      });
    test("a long script keeps reading messages at the foot of the visible column at 1180px", async ({
      page,
    }) => {
      // Imports, reviews and reads like the walks above; WebKit under a full parallel run needs the time.
      test.slow();
      await page.setViewportSize({ width: 1180, height: 820 });
      await holdToasts(page);
      await start(page);
      await page.locator("#draft-import").setInputFiles(draftFile(longScript));
      await page.locator(".review-primary").click();
      await expect(page.locator(".playback")).toHaveAttribute("data-phase", "idle");
      await page.evaluate(() => document.fonts.ready);
      await expectFootOfLongScript(page);
    });
    for (const locale of ["zh-Hant", "zh-Hans", "ja", "ko", "en", "de", "es"]) {
      test(`reading ${locale}: voice summary shares the clock row right under the script`, async ({
        page,
      }) => {
        await page.addInitScript((value) => localStorage.setItem("bragi-locale", value), locale);
        await start(page);
        await page.locator("#draft-import").setInputFiles(draftFile("故事開始。"));
        await page.locator(".review-primary").click();
        await expect(page.locator(".playback")).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        // Paused after playing, the clock shows its widest form: position and duration.
        await page.locator(".playback-primary").click();
        await expect(page.locator(".playback")).toHaveAttribute("data-phase", "playing");
        await page.evaluate(() => window.audioTest.finish());
        await expect(page.locator(".playback-clock")).toContainText("/");
        for (const width of [320, 390]) {
          await page.setViewportSize({ width, height: 700 });
          const layout = await page.locator(".playback-transport").evaluate((transport) => {
            const rect = (selector: string) =>
              (transport.querySelector(selector) as HTMLElement).getBoundingClientRect();
            const text = transport.querySelector(".playback-settings-text") as HTMLElement;
            return {
              transport: transport.getBoundingClientRect(),
              meter: rect(".playback-meter"),
              clock: rect(".playback-clock"),
              button: rect(".playback-settings-button"),
              text: rect(".playback-settings-text"),
              clipped: text.scrollHeight > text.clientHeight + 1,
              lines: Math.round(
                text.getBoundingClientRect().height /
                  Number.parseFloat(getComputedStyle(text).lineHeight),
              ),
              overflow: document.documentElement.scrollWidth - window.innerWidth,
            };
          });
          expect(layout.overflow).toBeLessThanOrEqual(0);
          // Same row: vertical centres agree, the summary sits right of the clock.
          const middle = (r: DOMRect) => r.y + r.height / 2;
          expect(Math.abs(middle(layout.clock) - middle(layout.text))).toBeLessThan(2);
          expect(layout.text.x).toBeGreaterThanOrEqual(layout.clock.x + layout.clock.width + 8);
          // Right-aligned and inside the transport.
          expect(layout.button.x + layout.button.width).toBeLessThanOrEqual(
            layout.transport.x + layout.transport.width + 7,
          );
          expect(layout.transport.x + layout.transport.width - layout.text.right).toBeLessThan(24);
          // A long summary may take a second line, never more, and never grows the row.
          expect(layout.lines).toBeLessThanOrEqual(2);
          expect(layout.clipped).toBe(false);
          expect(layout.meter.height).toBeCloseTo(44, 0);
          expect(layout.button.height).toBeGreaterThanOrEqual(44);
          // The row starts right under the script's divider.
          expect(layout.clock.y - layout.transport.y).toBeLessThanOrEqual(20);
        }
        const summary = page.locator(".playback-settings-button");
        await expect(summary).toHaveAccessibleName(/Kore/);
        await summary.click();
        await expect(page.locator("dialog[open] .voice-current")).toBeFocused();
      });
    }
    test("sliders, stage bars and native choices use theme tokens", async ({ page }) => {
      await start(page);
      await page.route("**/api/ocr", () => undefined);
      await selectImage(page);
      await page.getByRole("button", { name: "辨識文字", exact: true }).click();
      const stages = page.locator(".recognition-stages");
      await expect(stages.locator("[aria-current=step]")).toHaveText("辨識與分段");
      const tracks = await stages.locator("li").evaluateAll((items) =>
        items.map((item) => ({
          border: getComputedStyle(item).borderTopColor,
          weight: getComputedStyle(item).fontWeight,
          check: !!item.querySelector("svg"),
        })),
      );
      const ok = await page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.color = "var(--ok)";
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      });
      // Done, done, current: done stages carry a check and a lighter track than the current one.
      expect(tracks.map((track) => track.check)).toEqual([true, true, false]);
      expect(tracks[0]?.border).toBe(tracks[1]?.border);
      expect(tracks[0]?.border).not.toBe(tracks[2]?.border);
      expect(tracks[0]?.border).not.toBe(ok);
      expect(Number(tracks[2]?.weight)).toBeGreaterThan(Number(tracks[0]?.weight));
      expect(await bluePixels(stages)).toBe(0);
      expect(await nativeControls(page)).toEqual([]);
      await page.getByRole("button", { name: "取消辨識", exact: true }).click();
      await page.unroute("**/api/ocr");
      await mockSignedInApi(page);
      await recognize(page);

      const preview = page.locator(".speech-preview").first();
      await preview.getByRole("button", { name: "產生試聽" }).click();
      await expect(preview.locator("input[type=range]")).toBeEnabled();
      expect(await nativeControls(page)).toEqual([]);
      expect(await bluePixels(preview.locator(".preview-transport"))).toBe(0);
      await preview.getByRole("button", { name: "暫停", exact: true }).click();

      const sheet = await openSettings(page);
      await sheet.getByRole("button", { name: "試聽這個聲音" }).click();
      await expect(sheet.locator(".voice-sample input[type=range]")).toBeEnabled();
      expect(await nativeControls(page)).toEqual([]);
      expect(await bluePixels(sheet.locator(".voice-sample .preview-transport"))).toBe(0);
      await openVoicePicker(page);
      expect(await nativeControls(page)).toEqual([]);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await expect(page.locator("dialog[open]")).toHaveCount(0);

      await page.getByRole("button", { name: /^進入朗讀/ }).click();
      await expect(page.locator(".playback-seek")).toBeVisible();
      expect(await nativeControls(page)).toEqual([]);
      expect(await bluePixels(page.locator(".playback-transport"))).toBe(0);
    });
    test("privacy warning reads as a list item; recognition shows each stage once", async ({
      page,
    }) => {
      await start(page);
      const note = page.locator(".privacy-note");
      if (!(await note.evaluate((element) => (element as HTMLDetailsElement).open)))
        await note.locator("summary").click();
      const items = await note.locator("li").evaluateAll((list) =>
        list.map((item) => ({
          text: item.textContent ?? "",
          x: item.getBoundingClientRect().x,
          size: getComputedStyle(item).fontSize,
          color: getComputedStyle(item).color,
        })),
      );
      expect(items).toHaveLength(3);
      expect(items[2]?.text).toBe("請避免拍入無關的人臉、聯絡資訊或其他敏感資料。");
      for (const item of items.slice(1)) {
        expect(item.x).toBeCloseTo(items[0]?.x ?? 0, 0);
        expect(item.size).toBe(items[0]?.size);
        expect(item.color).toBe(items[0]?.color);
      }
      await expect(note.locator(":scope > p")).toHaveCount(0);

      await page.route("**/api/ocr", () => undefined);
      await selectImage(page);
      await page.getByRole("button", { name: "辨識文字", exact: true }).click();
      await expect(page.locator(".recognition-stages [aria-current=step]")).toBeVisible();
      const status = page.locator(".capture-status [role=status]");
      await expect(status).toHaveText("辨識與分段…");
      // The status stays in the accessibility tree but is not drawn under the stage bar.
      expect(
        await status.evaluate((element) => element.getBoundingClientRect().height),
      ).toBeLessThanOrEqual(1);
      const stages = await box(page.locator(".recognition-stages"));
      const cancel = await box(page.getByRole("button", { name: "取消辨識", exact: true }));
      expect(cancel.y - stages.y - stages.height).toBeGreaterThanOrEqual(12);
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
    test("a paragraph preview's status never draws over the compact actions", async ({ page }) => {
      await start(page);
      await recognize(page);
      const row = page.locator(".segment-compact-actions").first();
      const status = row.locator(".inline-status");
      const idle = await box(row);
      // Empty, the status sits outside the row and is clipped to nothing.
      const empty = await status.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height, clip: getComputedStyle(element).clipPath };
      });
      expect(empty.width).toBeLessThanOrEqual(1);
      expect(empty.height).toBeLessThanOrEqual(1);
      expect(empty.clip).not.toBe("none");

      await status.locator("[role=status]").evaluate((element) => {
        element.textContent = "試聽狀態".repeat(4) + "x".repeat(200);
      });
      const text = await box(status);
      const buttons = await row
        .locator(":scope button")
        .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().bottom));
      const shown = await box(row);
      // With text, the status takes its own line under the buttons and wraps inside the row.
      expect(text.y).toBeGreaterThanOrEqual(Math.max(...buttons));
      expect(text.x).toBeGreaterThanOrEqual(shown.x);
      expect(text.x + text.width).toBeLessThanOrEqual(shown.x + shown.width + 0.5);
      expect(shown.height).toBeGreaterThan(idle.height);
      expect(text.y + text.height).toBeLessThanOrEqual(shown.y + shown.height + 0.5);

      await status.locator("[role=status]").evaluate((element) => {
        element.textContent = "";
      });
      expect((await box(row)).height).toBeCloseTo(idle.height, 0);
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
