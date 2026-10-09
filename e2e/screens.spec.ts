import { expect, type Locator, type Page, test } from "@playwright/test";
import de from "../src/lib/i18n/messages/de";
import en from "../src/lib/i18n/messages/en";
import es from "../src/lib/i18n/messages/es";
import ja from "../src/lib/i18n/messages/ja";
import ko from "../src/lib/i18n/messages/ko";
import zhHans from "../src/lib/i18n/messages/zh-Hans";
import zhHant from "../src/lib/i18n/messages/zh-Hant";
import { goToStep, image, mockSignedInApi, recognize, segments, selectImage } from "./fixtures";

async function importDraft(page: Page, content = segments) {
  await page.locator("#draft-import").setInputFiles({
    name: "draft.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "bragi-draft",
        version: 1,
        exportedAt: "2026-10-09T00:00:00Z",
        detectedLanguage: "繁體中文",
        segments: content,
      }),
    ),
  });
}

async function bounds(locator: Locator) {
  const value = await locator.boundingBox();
  if (!value) throw new Error(`Element has no bounds: ${locator}`);
  return value;
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("capture entry points fit the first phone screen and preview can collapse", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSignedInApi(page);
  await page.goto("/");
  for (const selector of [
    "#capture-heading",
    "label[for=camera-input]",
    "label[for=library-input]",
    "label[for=draft-import]",
  ]) {
    const box = await bounds(page.locator(selector));
    expect(box).not.toBeNull();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
  }
  await selectImage(page);
  await expect(page.getByLabel("重拍", { exact: true })).toBeAttached();
  await expect(page.getByRole("button", { name: "辨識文字", exact: true })).toBeEnabled();
  await expect(page.getByAltText("準備上傳的圖片預覽")).toBeVisible();
  await page.getByText("已選圖片", { exact: true }).click();
  await expect(page.getByAltText("準備上傳的圖片預覽")).toBeHidden();
  await page.getByText("已選圖片", { exact: true }).click();
  await expect(page.getByAltText("準備上傳的圖片預覽")).toBeVisible();
  await expect(
    page.getByText("照片將傳送至 Google Gemini，最多保存 48 小時", { exact: true }),
  ).toBeVisible();
});

test("privacy opens on first use and collapses on later visits", async ({ page }) => {
  await mockSignedInApi(page);
  await page.goto("/");
  await expect(page.locator(".privacy-note")).toHaveAttribute("open", "");
  await page.reload();
  await expect(page.locator(".privacy-note")).not.toHaveAttribute("open");
  await page.getByText("資料如何處理", { exact: true }).click();
  await expect(
    page.getByText("照片的方向修正與壓縮先在此裝置完成。", { exact: true }),
  ).toBeVisible();
});

test("local image preparation shows its stage and cancellation ignores late failure", async ({
  page,
}) => {
  await mockSignedInApi(page);
  await page.addInitScript(() => {
    window.createImageBitmap = () =>
      new Promise<ImageBitmap>((_resolve, reject) => {
        Object.assign(window, { failPreparation: reject });
      });
  });
  await page.goto("/");
  await page
    .getByLabel("選擇圖片")
    .setInputFiles({ name: "slow.png", mimeType: "image/png", buffer: image });
  await expect(page.locator(".recognition-stages [aria-current=step]")).toHaveText("準備圖片");
  await page.getByRole("button", { name: "取消候選圖片" }).click();
  await page.evaluate(() =>
    (window as unknown as { failPreparation: (e: Error) => void }).failPreparation(
      new Error("late failure"),
    ),
  );
  await expect(page.locator(".recognition-stages")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "辨識文字", exact: true })).toHaveCount(0);
});

for (const [path, stage] of [
  ["uploads", "準備圖片"],
  ["upload-content", "上傳圖片"],
  ["ocr", "辨識與分段"],
] as const) {
  test(`cancelling ${path} aborts the request and preserves draft and candidate`, async ({
    page,
  }) => {
    await mockSignedInApi(page);
    await page.goto("/");
    await recognize(page);
    await page.getByLabel("口白文字", { exact: true }).first().fill("保留目前的故事。");
    await goToStep(page, "取圖");
    await selectImage(page);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**/api/${path}`, async (route) => {
      await held;
      await route.fallback();
    });
    const started = page.waitForRequest(`**/api/${path}`);
    await page.getByRole("button", { name: "辨識文字", exact: true }).click();
    await started;
    await expect(page.locator(".recognition-stages [aria-current=step]")).toHaveText(stage);
    await expect(page.locator(".recognition-stages li")).toHaveText([
      "準備圖片",
      "上傳圖片",
      "辨識與分段",
    ]);
    const aborted = page.waitForEvent("requestfailed", (r) => r.url().endsWith(`/api/${path}`));
    if (path === "upload-content")
      await page.getByRole("link", { name: "上一頁", exact: true }).click();
    else await page.getByRole("button", { name: "取消辨識", exact: true }).click();
    await aborted;
    release();
    await page.unroute(`**/api/${path}`);
    await expect(page.locator(".recognition-stages")).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByAltText("準備上傳的圖片預覽")).toBeVisible();
    await expect(page.locator(".capture-status")).toContainText("已取消辨識");
    await page.getByRole("button", { name: "返回目前的校對稿" }).click();
    await expect(page.getByLabel("口白文字", { exact: true }).first()).toHaveValue(
      "保留目前的故事。",
    );
    await goToStep(page, "取圖");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "辨識文字", exact: true }).click();
    await expect(page).toHaveURL(/\/review$/);
    await expect(page.getByLabel("口白文字", { exact: true }).first()).toHaveValue(
      segments[0]?.text ?? "",
    );
  });
}

test("late recognition cannot commit even when transport ignores abort", async ({ page }) => {
  await mockSignedInApi(page);
  await page.addInitScript(() => {
    const fetchOriginal = window.fetch;
    window.fetch = (input, options) =>
      String(input) === "/api/ocr"
        ? new Promise<Response>((resolve) =>
            Object.assign(window, {
              finishRecognition: () =>
                resolve(
                  new Response(
                    JSON.stringify({
                      detectedLanguage: "繁體中文",
                      segments: [{ id: "late", text: "遲到結果", suggestedToneHint: "" }],
                    }),
                    { headers: { "content-type": "application/json" } },
                  ),
                ),
            }),
          )
        : fetchOriginal(input, options);
  });
  await page.goto("/");
  await importDraft(page);
  await goToStep(page, "取圖");
  await selectImage(page);
  await page.getByRole("button", { name: "辨識文字", exact: true }).click();
  await expect(page.locator(".recognition-stages [aria-current=step]")).toHaveText("辨識與分段");
  await page.getByRole("button", { name: "取消辨識" }).click();
  await page.evaluate(() =>
    (window as unknown as { finishRecognition: () => void }).finishRecognition(),
  );
  await expect(page.locator(".capture-status")).toContainText("已取消辨識");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "返回目前的校對稿" }).click();
  await expect(page.getByLabel("口白文字", { exact: true }).first()).toHaveValue(
    segments[0]?.text ?? "",
  );
});

test("bottom action focuses the first invalid stable segment, including spoken text", async ({
  page,
}) => {
  await mockSignedInApi(page);
  await page.goto("/");
  await importDraft(page);
  await expect(page.getByRole("button", { name: "進入朗讀（2 段）" })).toBeVisible();
  const second = page.getByLabel("口白文字", { exact: true }).nth(1);
  await second.fill("");
  await page.getByRole("button", { name: "第 2 段需處理 →" }).click();
  await expect(second).toBeFocused();
  const editorBox = await bounds(second);
  const footerBox = await bounds(page.locator(".review-footer"));
  expect(editorBox.y + editorBox.height).toBeLessThanOrEqual(footerBox.y);
  await second.fill("新的段落。");
  await page.getByRole("button", { name: "另設朗讀文字" }).nth(1).click();
  const spoken = page.getByLabel("朗讀文字（只影響語音）");
  await spoken.fill("");
  await page.getByRole("button", { name: "第 2 段需處理 →" }).click();
  await expect(spoken).toBeFocused();
  await spoken.fill("新的段落。");
  await expect(page.getByRole("button", { name: "進入朗讀（2 段）" })).toBeVisible();
  await expect(page.locator(".text-budget").first()).not.toContainText("位元組");
});

test("export clears dirty state and undo to the exported snapshot clears it again", async ({
  page,
}) => {
  await mockSignedInApi(page);
  await page.goto("/");
  await importDraft(page);
  await expect(page.locator(".draft-dirty")).toHaveCount(0);
  const text = page.getByLabel("口白文字", { exact: true }).first();
  await text.fill("匯出版本。");
  await expect(page.locator(".draft-dirty")).toHaveText("有未匯出的變更");
  await expect(
    page.getByText("文字已在本機暫存；匯出可取得攜帶到其他裝置的備份。", { exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "匯出草稿", exact: true }).click();
  await download;
  await expect(page.locator(".draft-dirty")).toHaveCount(0);
  await text.fill("編輯版本。");
  await expect(page.locator(".draft-dirty")).toBeVisible();
  await page
    .locator(".review-heading-actions")
    .getByRole("button", { name: "復原", exact: true })
    .click();
  await expect(text).toHaveValue("匯出版本。");
  await expect(page.locator(".draft-dirty")).toHaveCount(0);
});

test("empty imports and deleting the final segment return to capture with a text action", async ({
  page,
}) => {
  await mockSignedInApi(page);
  await page.goto("/");
  await importDraft(page, []);
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByText("草稿沒有段落。可以重新取圖，或新增一段文字。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "新增文字段落" }).click();
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByRole("button", { name: "第 1 段需處理 →" })).toBeEnabled();
  await page.getByRole("button", { name: "刪除段落 1" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "新增文字段落" })).toBeVisible();
  await expect(page.getByRole("link", { name: "校對", exact: true })).toHaveCount(0);
});

test("tablet capture, review and reading use columns; text-only drafts use full width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await mockSignedInApi(page);
  await page.goto("/");
  await selectImage(page);
  const preview = await bounds(page.locator(".candidate-panel"));
  const controls = await bounds(page.locator(".capture-actions"));
  expect(preview.x + preview.width).toBeLessThanOrEqual(controls.x);
  await page.getByRole("button", { name: "辨識文字", exact: true }).click();
  const picture = await bounds(page.locator(".image-comparison"));
  const cards = await bounds(page.locator(".review-segments"));
  expect(picture.x + picture.width).toBeLessThanOrEqual(cards.x);
  await expect(page.getByAltText("校對用圖片")).toBeVisible();
  await page.getByRole("button", { name: /^進入朗讀/ }).click();
  const script = await bounds(page.locator(".playback-script"));
  const playback = await bounds(page.locator(".playback-controls"));
  expect(script.x + script.width).toBeLessThanOrEqual(playback.x);
  await expect(page.getByRole("button", { name: "選擇第 2 段" })).toBeVisible();
  await page.getByRole("button", { name: "選擇第 2 段" }).click();
  await expect(page.getByRole("heading", { name: "第 2 段，共 2 段" })).toBeVisible();
  await goToStep(page, "取圖");
  page.once("dialog", (dialog) => dialog.accept());
  await importDraft(page);
  await expect(page.locator(".image-comparison")).toHaveCount(0);
  await expect(page.locator(".review-no-image")).toBeVisible();
  const full = await bounds(page.locator(".review-segments"));
  expect(full.width).toBeGreaterThan(900);
  await expect(page.getByRole("button", { name: /^進入朗讀/ })).toBeEnabled();
  expect(await overflow(page)).toBe(0);
});

for (const [locale, dictionary] of Object.entries({
  "zh-Hant": zhHant,
  "zh-Hans": zhHans,
  ja,
  ko,
  en,
  de,
  es,
})) {
  test(`${locale} translates every screen and preserves imported content without overflow`, async ({
    page,
  }) => {
    await page.addInitScript((value) => localStorage.setItem("bragi-locale", value), locale);
    await page.setViewportSize({ width: 320, height: 844 });
    await mockSignedInApi(page);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator("#capture-heading")).toHaveText(dictionary["capture.heading"]);
    expect(await overflow(page)).toBe(0);
    await importDraft(page);
    await expect(page.locator("#review-heading")).toHaveText(dictionary["review.heading"]);
    await expect(page.locator("#segment-text-one")).toHaveValue(segments[0]?.text ?? "");
    await expect(page.locator("#segment-tone-one")).toHaveValue(
      segments[0]?.suggestedToneHint ?? "",
    );
    expect(await overflow(page)).toBe(0);
    await page.locator(".review-footer button").click();
    await expect(page.locator("#playback-heading")).toContainText("1");
    await expect(page.locator(".playback-script")).toContainText(segments[0]?.text ?? "");
    expect(await overflow(page)).toBe(0);
    await page.getByRole("button", { name: dictionary["settings.open"], exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: dictionary["settings.title"], exact: true }),
    ).toBeVisible();
    expect(await overflow(page)).toBe(0);
    const expectedFont =
      locale === "ja"
        ? "Noto Sans JP"
        : locale === "ko"
          ? "Noto Sans KR"
          : locale === "zh-Hans"
            ? "Noto Sans SC"
            : "Noto Sans TC";
    expect(
      await page.locator("body").evaluate((element) => getComputedStyle(element).fontFamily),
    ).toContain(expectedFont);
  });
}

for (const [language, expected] of [
  ["en-US", "en"],
  ["ja-JP", "ja"],
  ["zh-CN", "zh-Hans"],
  ["fr-FR", "zh-Hant"],
] as const) {
  test.describe(`browser ${language}`, () => {
    test.use({ locale: language });
    test("selects supported browser language only without a saved preference", async ({ page }) => {
      await mockSignedInApi(page);
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("lang", expected);
      await page.evaluate(() => localStorage.setItem("bragi-locale", "ko"));
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("lang", "ko");
    });
  });
}

test("review footer and focused editor stay above a shrinking visual viewport", async ({
  page,
}) => {
  await mockSignedInApi(page);
  await page.goto("/");
  await importDraft(page);
  const second = page.getByLabel("口白文字", { exact: true }).nth(1);
  await second.focus();
  await page.evaluate(() => {
    const viewport = window.visualViewport;
    if (!viewport) throw new Error("visualViewport unavailable");
    Object.defineProperty(viewport, "height", { configurable: true, value: 500 });
    Object.defineProperty(viewport, "offsetTop", { configurable: true, value: 0 });
    viewport.dispatchEvent(new Event("resize"));
  });
  await expect(second).toBeFocused();
  const footer = await bounds(page.locator(".review-footer"));
  const editor = await bounds(second);
  expect(footer.y + footer.height).toBeLessThanOrEqual(501);
  expect(editor.y + editor.height).toBeLessThanOrEqual(footer.y);
  expect(editor.y).toBeGreaterThanOrEqual(88);
  await goToStep(page, "取圖");
  expect(
    await page
      .locator("html")
      .evaluate((element) => element.style.getPropertyValue("--keyboard-inset")),
  ).toBe("");
});

for (const status of [200, 500, 401]) {
  test(`a cancelled OCR response (${status}) cannot stop an immediate retry`, async ({ page }) => {
    await mockSignedInApi(page);
    await page.addInitScript(() => {
      const originalFetch = window.fetch;
      const pending: ((response: Response) => void)[] = [];
      Object.assign(window, {
        finishPending: (index: number, status: number) =>
          pending[index]?.(
            new Response(
              JSON.stringify(
                status !== 200
                  ? {
                      error: {
                        code: status === 401 ? "UNAUTHORIZED" : "OCR_FAILED",
                        message: "late failure",
                        requestId: "late-cancelled",
                        retryable: true,
                      },
                    }
                  : {
                      detectedLanguage: "繁體中文",
                      segments: [
                        { id: "new", text: "重新辨識的故事。", suggestedToneHint: "平靜" },
                      ],
                    },
              ),
              { status, headers: { "content-type": "application/json" } },
            ),
          ),
      });
      window.fetch = (input, options) =>
        String(input) === "/api/ocr"
          ? new Promise<Response>((resolve) => pending.push(resolve))
          : originalFetch(input, options);
    });
    await page.goto("/");
    await selectImage(page);
    await page.getByRole("button", { name: "辨識文字", exact: true }).click();
    await expect(page.locator(".recognition-stages [aria-current=step]")).toHaveText("辨識與分段");
    await page.getByRole("button", { name: "取消辨識" }).click();
    await page.getByRole("button", { name: "辨識文字", exact: true }).click();
    await expect(page.locator(".recognition-stages [aria-current=step]")).toHaveText("辨識與分段");
    await page.evaluate(
      (code) =>
        (
          window as unknown as { finishPending: (index: number, status: number) => void }
        ).finishPending(0, code),
      status,
    );
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator(".recognition-stages [aria-current=step]")).toHaveText("辨識與分段");
    await expect(page.getByRole("button", { name: "取消辨識" })).toBeEnabled();
    await page.evaluate(() =>
      (
        window as unknown as { finishPending: (index: number, status: number) => void }
      ).finishPending(1, 200),
    );
    await expect(page).toHaveURL(/\/review$/);
    await expect(page.getByLabel("口白文字", { exact: true })).toHaveValue("重新辨識的故事。");
  });
}
