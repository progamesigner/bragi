import { expect, type Page, test } from "@playwright/test";
import {
  closeComparison,
  mockSignedInApi,
  moreEditing,
  openComparison,
  recognize,
  selectImage,
} from "./fixtures";

const settingsButton = (page: Page) => page.getByRole("button", { name: "設定", exact: true });

test("settings sheet is a named modal that keeps and returns focus", async ({ page }) => {
  await mockSignedInApi(page);
  await page.goto("/");
  await settingsButton(page).click();
  const sheet = page.getByRole("dialog", { name: "設定" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("radio", { name: "標準", exact: true })).toBeFocused();
  await expect(sheet.getByRole("button", { name: "關閉設定" })).toBeVisible();

  // The page behind is inert: Tab moves through the sheet (and the browser's own UI), never the page.
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press("Tab");
    expect(
      await sheet.evaluate(
        (dialog) =>
          document.activeElement === document.body || dialog.contains(document.activeElement),
      ),
    ).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(settingsButton(page)).toBeFocused();

  await settingsButton(page).click();
  await sheet.getByRole("button", { name: "關閉設定" }).click();
  await expect(sheet).toBeHidden();
  await expect(settingsButton(page)).toBeFocused();

  // When the opener is gone, focus lands on the page heading instead of the document body.
  await settingsButton(page).click();
  await page.evaluate(() => document.querySelector(".top-nav .settings-button")?.remove());
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
});

test("theme follows the system until a choice is saved", async ({ page }) => {
  await mockSignedInApi(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const html = page.locator("html");
  const themeColor = page.locator('meta[name="theme-color"]');
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(themeColor).toHaveAttribute("content", "#171512");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(themeColor).toHaveAttribute("content", "#f6f1e7");

  await settingsButton(page).click();
  await page.getByRole("group", { name: "外觀" }).getByRole("radio", { name: "深色" }).check();
  await expect(html).toHaveAttribute("data-theme", "dark");
  const background = () =>
    page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--bg").trim());
  expect(await background()).toBe("#171512");
  // Text must resolve to the dark theme's light ink, not fall back to black.
  expect(await page.evaluate(() => getComputedStyle(document.body).color)).toBe(
    "rgb(243, 234, 216)",
  );

  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(themeColor).toHaveAttribute("content", "#171512");
  await settingsButton(page).click();
  await expect(
    page.getByRole("group", { name: "外觀" }).getByRole("radio", { name: "深色" }),
  ).toBeChecked();
  await page.getByRole("group", { name: "外觀" }).getByRole("radio", { name: "淺色" }).check();
  expect(await background()).toBe("#f6f1e7");
  await expect(themeColor).toHaveAttribute("content", "#f6f1e7");
  await page.getByRole("group", { name: "外觀" }).getByRole("radio", { name: "跟隨系統" }).check();
  await expect(html).toHaveAttribute("data-theme", "light");
});

test("interface language is translated, remembered and sets lang", async ({ page }) => {
  await mockSignedInApi(page);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant");
  await settingsButton(page).click();
  await page.getByLabel("介面語言").selectOption("ja");
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(page.getByRole("heading", { name: "次の場面を準備" })).toBeVisible();
});

test("preferences still work when storage is blocked", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
  });
  await mockSignedInApi(page);
  await page.goto("/");
  await settingsButton(page).click();
  await page.getByRole("group", { name: "外觀" }).getByRole("radio", { name: "深色" }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("controls meet touch target sizes and icon buttons have names", async ({ page }) => {
  await mockSignedInApi(page);
  await page.goto("/");
  await recognize(page);
  await page.getByRole("button", { name: /^進入朗讀/ }).click();
  await page.getByRole("button", { name: "返回校對" }).click();

  const measure = () =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".button, .select-control")]
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => ({
          name: element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "",
          height: element.getBoundingClientRect().height,
          width: element.getBoundingClientRect().width,
          compact: element.classList.contains("button-compact"),
          icon: element.classList.contains("button-icon"),
        })),
    );
  const controls = await measure();
  expect(controls.length).toBeGreaterThan(10);
  for (const control of controls) {
    expect(control.name, JSON.stringify(control)).not.toBe("");
    expect(control.height, control.name).toBeGreaterThanOrEqual(control.compact ? 44 : 48);
    if (control.icon) expect(control.width, control.name).toBeGreaterThanOrEqual(44);
  }
});

test("API failures explain the cause first and keep the request ID in details", async ({
  page,
}) => {
  await mockSignedInApi(page);
  await page.route("**/api/ocr", (route) =>
    route.fulfill({
      status: 429,
      headers: { "retry-after": "20" },
      json: {
        error: {
          code: "OCR_RATE_LIMITED",
          message: "OCR rate limit reached",
          requestId: "ocr-limit-1",
          retryable: true,
        },
      },
    }),
  );
  await page.goto("/");
  await selectImage(page);
  await page.getByRole("button", { name: /^(辨識文字|重新辨識)$/ }).click();
  const alert = page.getByRole("alert");
  await expect(alert.locator("p")).toHaveText(
    "請求太頻繁，Gemini 暫時拒絕。請稍候再試。（約 20 秒後可重試）",
  );
  await expect(alert.getByText("ocr-limit-1")).toBeHidden();
  await alert.getByText("技術詳情").click();
  await expect(alert.getByText("ocr-limit-1")).toBeVisible();
  await expect(alert.getByText("OCR_RATE_LIMITED")).toBeVisible();
  await expect(alert.getByText("429")).toBeVisible();
});

for (const width of [320, 1280]) {
  test(`no horizontal overflow at ${width}px`, async ({ page }) => {
    await mockSignedInApi(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    expect(await overflow()).toBe(0);
    await recognize(page);
    if (width < 900) await openComparison(page);
    expect(await overflow()).toBe(0);
    await closeComparison(page);
    await page.getByRole("button", { name: /^進入朗讀/ }).click();
    expect(await overflow()).toBe(0);
    await settingsButton(page).click();
    expect(await overflow()).toBe(0);
  });
}

test("leaving playback keeps the draft, its history and the current segment", async ({ page }) => {
  await mockSignedInApi(page);
  await page.goto("/");
  await recognize(page);
  await moreEditing(page);
  await page.getByLabel("朗讀語氣").fill("急促");
  await page.getByRole("button", { name: /^進入朗讀/ }).click();
  await page.getByRole("button", { name: "下一段", exact: true }).click();
  await expect(page.getByRole("heading", { name: "第 2 段，共 2 段" })).toBeVisible();
  await page.getByRole("button", { name: "返回校對" }).click();
  await moreEditing(page);
  await expect(page.getByLabel("朗讀語氣")).toHaveValue("急促");
  await expect(page.getByRole("button", { name: "復原", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: /^進入朗讀/ }).click();
  await expect(page.getByRole("heading", { name: "第 2 段，共 2 段" })).toBeVisible();
});
