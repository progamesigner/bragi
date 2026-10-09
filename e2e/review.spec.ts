import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import {
  closeComparison,
  closeSettings,
  draftFile,
  goToStep,
  mockSignedInApi,
  moreEditing,
  openComparison,
  openSettings,
  recognize,
  toast,
} from "./fixtures";

const texts = (page: Page) => page.locator(".review-segment > textarea");
const undo = (page: Page) =>
  page.locator(".review-heading-actions").getByRole("button", { name: "復原", exact: true });
const redo = (page: Page) =>
  page.locator(".review-heading-actions").getByRole("button", { name: "重做", exact: true });
async function enter(page: Page, count = 3, overrides: Record<string, unknown> = {}) {
  await mockSignedInApi(page);
  await page.goto("/");
  await page.locator("#draft-import").setInputFiles({
    ...draftFile("placeholder"),
    buffer: Buffer.from(
      JSON.stringify({
        format: "bragi-draft",
        version: 1,
        exportedAt: "2026-10-09T00:00:00Z",
        detectedLanguage: "繁體中文",
        segments: Array.from({ length: count }, (_, i) => ({
          id: `s${i}`,
          text: `段落 ${i + 1} 的故事。`,
          suggestedToneHint: "平靜",
          ...(i === 0 ? overrides : {}),
        })),
      }),
    ),
  });
  await expect(page).toHaveURL(/\/review$/);
  await expect(texts(page)).toHaveCount(count);
}
async function checkpoint(page: Page) {
  await page.locator("#review-heading").focus();
}
async function exported(page: Page) {
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "匯出草稿", exact: true }).click();
  return JSON.parse(await readFile(await (await downloaded).path(), "utf8"));
}

test("compact cards expose one expandable editor and only one primary action", async ({ page }) => {
  await enter(page);
  await expect(page.locator(".segment-more")).toHaveCount(0);
  await expect(page.getByLabel("朗讀語氣", { exact: true })).toHaveCount(0);
  await expect(page.locator(".review .button-primary")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "更多編輯", exact: true })).toHaveCount(3);
  await moreEditing(page);
  await expect(page.locator(".segment-more")).toHaveCount(1);
  await moreEditing(page, 1);
  await expect(page.locator(".segment-more")).toHaveCount(1);
  await expect(page.locator("#segment-more-s1")).toBeVisible();
  await texts(page).nth(2).focus();
  await expect(page.locator(".segment-more")).toHaveCount(0);
  await moreEditing(page, 1);
  await page.getByRole("button", { name: "收合編輯" }).click();
  await expect(page.locator(".segment-more")).toHaveCount(0);
});

test("more editing preserves emoji and combining text through split, merge and insertion", async ({
  page,
}) => {
  const text = "甲👨‍👩‍👧‍👦e\u0301乙";
  await enter(page, 2, { text, spokenText: "發音" });
  let card = await moreEditing(page);
  await expect(card).toContainText("分割會移除這段的朗讀修正");
  await texts(page)
    .first()
    .evaluate((field: HTMLTextAreaElement) => field.setSelectionRange(2, 2));
  await card.getByRole("button", { name: "從游標分割" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(texts(page)).toHaveCount(2);
  await texts(page)
    .first()
    .evaluate((field: HTMLTextAreaElement) => field.setSelectionRange(12, 12));
  await card.getByRole("button", { name: "從游標分割" }).click();
  await expect(texts(page)).toHaveCount(3);
  await expect(page.locator("#segment-text-s0")).toBeFocused();
  expect(
    (
      await texts(page).evaluateAll((fields) =>
        fields.map((field) => (field as HTMLTextAreaElement).value),
      )
    )
      .slice(0, 2)
      .join(""),
  ).toBe(text);
  await expect(card.getByLabel("朗讀文字（只影響語音）")).toHaveCount(0);
  await card.getByRole("button", { name: "合併下一段" }).click();
  await expect(texts(page)).toHaveCount(2);
  expect((await texts(page).first().inputValue()).replaceAll("\n", "")).toBe(text);
  await expect(page.locator("#segment-text-s0")).toBeFocused();
  await card.getByRole("button", { name: "在下方新增" }).click();
  await expect(texts(page)).toHaveCount(3);
  await expect(texts(page).nth(1)).toBeFocused();
  card = await moreEditing(page, 1);
  await texts(page).nth(1).fill("新增的文字。");
  await card.getByLabel("朗讀語氣", { exact: true }).fill("期待");
  await card.getByRole("button", { name: "另設朗讀文字" }).click();
  await card.getByLabel("朗讀文字（只影響語音）").fill("新增，的文字。");
  const file = await exported(page);
  expect(file.segments[1]).toMatchObject({
    text: "新增的文字。",
    suggestedToneHint: "期待",
    spokenText: "新增，的文字。",
  });
});

test("over-limit suggestions apply once, keep every grapheme, and undo just the split", async ({
  page,
}) => {
  const text = "甲e\u0301👨‍👩‍👧‍👦".repeat(70);
  await enter(page, 2, { text, spokenText: "修正" });
  await expect(page.locator(".split-suggestion")).toBeVisible();
  await expect(texts(page).first()).toHaveAttribute("aria-invalid", "true");
  await page.locator(".split-suggestion").getByRole("button", { name: "按句自動分段" }).click();
  const parts = await texts(page).evaluateAll((fields) =>
    fields.map((field) => (field as HTMLTextAreaElement).value),
  );
  expect(parts.slice(0, -1).join("")).toBe(text);
  await expect(page.locator("#segment-text-s0")).toBeFocused();
  await toast(page).getByRole("button", { name: "復原" }).click();
  await expect(texts(page)).toHaveCount(2);
  await expect(texts(page).first()).toHaveValue(text);
  const file = await exported(page);
  expect(file.segments[0].spokenText).toBe("修正");
});

for (const count of [10, 20, 50]) {
  for (const width of [390, 1180]) {
    test(`${count} paragraphs jump by stable ID at ${width}px with issue markers`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await enter(page, count, { text: "" });
      if (width < 900) await page.getByRole("button", { name: "段落列表", exact: true }).click();
      const navigation = page.getByRole("navigation", { name: "段落列表" });
      await expect(navigation.getByRole("button")).toHaveCount(count);
      await expect(navigation.getByRole("button").first()).toContainText("需修正");
      await navigation.getByRole("button").last().click();
      await expect(page.locator(`#segment-text-s${count - 1}`)).toBeFocused();
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      await expect(page.getByRole("dialog", { name: "段落列表" })).toBeHidden();
      await page.getByRole("button", { name: "第 1 段需處理 →" }).click();
      await expect(page.locator("#segment-text-s0")).toBeFocused();
    });
  }
}

test("delete falls forward then backward; toast restores the removed stable ID and position", async ({
  page,
}) => {
  await enter(page, 10);
  await moreEditing(page, 8);
  await page.locator("#segment-text-s8").focus();
  await page
    .locator("#segment-text-s8")
    .evaluate((field: HTMLTextAreaElement) => field.setSelectionRange(2, 4));
  await page.getByRole("button", { name: "刪除段落 9" }).focus();
  const scroll = await page.evaluate(() => window.scrollY);
  await page.getByRole("button", { name: "刪除段落 9" }).click();
  await expect(page.locator("#segment-text-s9")).toBeFocused();
  await toast(page).getByRole("button", { name: "復原" }).click();
  await expect(page.locator("#segment-text-s8")).toBeFocused();
  expect(
    await page
      .locator("#segment-text-s8")
      .evaluate((field: HTMLTextAreaElement) => [field.selectionStart, field.selectionEnd]),
  ).toEqual([2, 4]);
  expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(scroll, 0);
  await moreEditing(page, 9);
  await page.getByRole("button", { name: "刪除段落 10" }).click();
  await expect(page.locator("#segment-text-s8")).toBeFocused();
});

for (const action of ["delete", "merge"] as const) {
  test(`${action} toast undoes its own action and expires after another edit`, async ({ page }) => {
    await enter(page);
    await texts(page).first().fill("先前的編輯。");
    const card = await moreEditing(page);
    await card
      .getByRole("button", {
        name: action === "delete" ? "刪除段落 1" : "合併下一段",
        exact: true,
      })
      .click();
    const original = await texts(page).evaluateAll((fields) =>
      fields.map((field) => (field as HTMLTextAreaElement).value),
    );
    await toast(page).getByRole("button", { name: "復原" }).click();
    await expect(texts(page)).toHaveCount(3);
    await expect(texts(page).first()).toHaveValue("先前的編輯。");
    const again = await moreEditing(page);
    await again
      .getByRole("button", {
        name: action === "delete" ? "刪除段落 1" : "合併下一段",
        exact: true,
      })
      .click();
    expect(
      await texts(page).evaluateAll((fields) =>
        fields.map((field) => (field as HTMLTextAreaElement).value),
      ),
    ).toEqual(original);
    await expect(toast(page).getByRole("button", { name: "復原" })).toBeVisible();
    await texts(page).first().fill("最新輸入。");
    await expect(toast(page).getByRole("button", { name: "復原" })).toHaveCount(0);
    await undo(page).click();
    await expect(texts(page)).toHaveCount(2);
    expect(
      await texts(page).evaluateAll((fields) =>
        fields.map((field) => (field as HTMLTextAreaElement).value),
      ),
    ).toEqual(original);
  });
}

test("last paragraph deletion can be restored from capture", async ({ page }) => {
  await enter(page, 1);
  const card = await moreEditing(page);
  await card.getByRole("button", { name: "刪除段落 1" }).click();
  await expect(page).toHaveURL(/\/$/);
  await toast(page).getByRole("button", { name: "復原" }).click();
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.locator("#segment-text-s0")).toBeFocused();
});

test("a focused merge toast stays until activated", async ({ page }) => {
  await enter(page);
  const card = await moreEditing(page);
  await card.getByRole("button", { name: "合併下一段" }).click();
  const action = toast(page).getByRole("button", { name: "復原" });
  await action.focus();
  await page.waitForTimeout(6100);
  await expect(action).toBeFocused();
  await action.click();
  await expect(page.locator("#segment-text-s0")).toBeFocused();
});

for (const shortcut of ["Control+z", "Meta+z", "Control+Shift+z", "Meta+Shift+z", "Control+y"]) {
  test(`workspace shortcut ${shortcut} performs a single action`, async ({ page }) => {
    await enter(page);
    await texts(page).first().fill("改動。");
    await checkpoint(page);
    const isRedo = shortcut.includes("Shift") || shortcut.endsWith("y");
    if (isRedo) {
      await undo(page).click();
      await checkpoint(page);
    }
    await page.keyboard.press(shortcut);
    await expect(texts(page).first()).toHaveValue(isRedo ? "改動。" : "段落 1 的故事。");
    if (!isRedo) await expect(undo(page)).toBeDisabled();
  });
}

test("native field undo and redo run before workspace history, without a double undo", async ({
  page,
}) => {
  await enter(page);
  await texts(page).nth(1).fill("先前 checkpoint。");
  await checkpoint(page);
  const field = texts(page).first();
  const original = await field.inputValue();
  await field.focus();
  await field.press("End");
  await page.keyboard.type(" appended");
  await page.keyboard.press("Control+z");
  await expect(field).toHaveValue(original);
  await expect(texts(page).nth(1)).toHaveValue("先前 checkpoint。");
  await page.keyboard.press("Control+Shift+z");
  await expect(field).toHaveValue(`${original} appended`);
  await page.keyboard.press("Control+z");
  await expect(field).toHaveValue(original);
  await page.keyboard.press("Control+y");
  await expect(field).toHaveValue(`${original} appended`);
  await page.keyboard.press("Control+z");
  await expect(field).toHaveValue(original);
  // Once native undo reaches the session baseline, the next undo owns workspace History.
  await page.keyboard.press("Control+z");
  await expect(texts(page).nth(1)).toHaveValue("段落 2 的故事。");
});

test("IME defers input, ignores shortcuts and splitting, then commits one completed value", async ({
  page,
}) => {
  await enter(page, 2);
  const card = await moreEditing(page);
  await texts(page).first().focus();
  await texts(page).first().dispatchEvent("compositionstart", { data: "" });
  await texts(page)
    .first()
    .evaluate((field: HTMLTextAreaElement) => {
      field.value = "輸入中的字";
      field.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertCompositionText",
          isComposing: true,
        }),
      );
    });
  await page.keyboard.press("Control+z");
  await card.getByRole("button", { name: "從游標分割" }).dispatchEvent("click");
  await expect(texts(page)).toHaveCount(2);
  await expect(undo(page)).toBeDisabled();
  await expect(page.locator(".segment-tone-summary").first()).toContainText("平靜");
  await texts(page)
    .first()
    .evaluate((field: HTMLTextAreaElement) => {
      field.value = "完成輸入。";
      field.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "完成輸入。" }),
      );
    });
  await checkpoint(page);
  await undo(page).click();
  await expect(texts(page).first()).toHaveValue("段落 1 的故事。");
  await expect(undo(page)).toBeDisabled();
  await redo(page).click();
  await expect(texts(page).first()).toHaveValue("完成輸入。");
});

test("shortcuts ignore sheets and repeat, and repeated Enter cannot delete twice", async ({
  page,
}) => {
  await enter(page);
  await texts(page).first().fill("更改。");
  await checkpoint(page);
  await page
    .locator("#review-heading")
    .dispatchEvent("keydown", { key: "z", ctrlKey: true, repeat: true });
  await expect(texts(page).first()).toHaveValue("更改。");
  await openSettings(page);
  await page.keyboard.press("Control+z");
  await closeSettings(page);
  await expect(texts(page).first()).toHaveValue("更改。");
  const card = await moreEditing(page);
  const button = card.getByRole("button", { name: "刪除段落 1" });
  const prevented = await button.evaluate(
    (element) =>
      !element.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
          repeat: true,
        }),
      ),
  );
  expect(prevented).toBe(true);
  await expect(texts(page)).toHaveCount(3);
});

for (const width of [320, 1280]) {
  test(`review touch targets and compact/expanded/list/image layouts fit ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockSignedInApi(page);
    await page.goto("/");
    await recognize(page);
    const check = async () => {
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBe(0);
      const controls = await page
        .locator(".review .button:visible, dialog[open] .button:visible")
        .evaluateAll((buttons) =>
          buttons.map((b) => ({
            height: b.getBoundingClientRect().height,
            primary: b.classList.contains("button-primary"),
          })),
        );
      for (const control of controls)
        expect(control.height).toBeGreaterThanOrEqual(control.primary ? 48 : 44);
    };
    await check();
    await moreEditing(page);
    await check();
    if (width < 900) {
      await page.getByRole("button", { name: "段落列表", exact: true }).click();
      await check();
      await page.keyboard.press("Escape");
    }
    await openComparison(page);
    await check();
    await closeComparison(page);
    await expect(page.locator(".review .button-primary")).toHaveCount(1);
  });
}

test("prepared image sheet supports buttons, pinch and drag, returns focus, and hides without an image", async ({
  page,
}) => {
  await mockSignedInApi(page);
  await page.goto("/");
  await recognize(page);
  await openComparison(page);
  const sheet = page.getByRole("dialog", { name: "查看圖片對照" });
  const image = sheet.getByAltText("校對用圖片");
  const bytes = await image.evaluate(async (img: HTMLImageElement) =>
    Array.from(new Uint8Array(await (await fetch(img.src)).arrayBuffer())),
  );
  const scroller = sheet.locator(".comparison-scroller");
  await sheet.getByRole("button", { name: "放大", exact: true }).click();
  await expect(scroller).toHaveAttribute("data-zoom", "1.50");
  await sheet.getByRole("button", { name: "縮小", exact: true }).click();
  await expect(scroller).toHaveAttribute("data-zoom", "1.00");
  // CDP sends actual multi-touch input through Chromium's pointer capture implementation.
  const cdp = await page.context().newCDPSession(page);
  const box = await scroller.boundingBox();
  if (!box) throw new Error("Missing image viewport");
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(box.height / 2, 60);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: x - 25, y, id: 1 },
      { x: x + 25, y, id: 2 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: x - 70, y, id: 1 },
      { x: x + 70, y, id: 2 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => scroller.getAttribute("data-zoom")).not.toBe("1.00");
  await scroller.evaluate((element) => {
    element.scrollLeft = 0;
  });
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 60, y);
  await page.mouse.up();
  expect(await scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  expect(
    await image.evaluate(async (img: HTMLImageElement) =>
      Array.from(new Uint8Array(await (await fetch(img.src)).arrayBuffer())),
    ),
  ).toEqual(bytes);
  await closeComparison(page);
  await expect(page.getByRole("button", { name: "查看圖片對照" })).toBeFocused();
  await goToStep(page, "取圖");
  await page.locator("#draft-import").setInputFiles(draftFile("文字稿"));
  await page
    .getByRole("dialog", { name: "匯入草稿？" })
    .getByRole("button", { name: "不匯出，直接匯入" })
    .click();
  await expect(page.getByRole("button", { name: "查看圖片對照" })).toHaveCount(0);
  await expect(page.locator(".review-no-image")).toBeVisible();
});
