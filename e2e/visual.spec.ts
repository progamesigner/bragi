import { expect, type Page, test } from "@playwright/test";
import { mockAudio } from "./audio-fixture";
import {
  draftFile,
  goToStep,
  mockSignedInApi,
  openSettings,
  recognize,
  selectImage,
} from "./fixtures";
import { elementStyle, pageStyle, settle } from "./visual-capture";

async function snap(page: Page, name: string, stylePath: string[] = [pageStyle]) {
  await settle(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page).toHaveScreenshot(`${name}.png`, {
    // Keep the fixed review action in its real viewport position.
    fullPage: !name.startsWith("review") && !name.startsWith("toast"),
    animations: "disabled",
    stylePath,
  });
}

async function snapReviewCard(page: Page, name: string) {
  await settle(page);
  await expect(page.locator(".review-segment").first()).toHaveScreenshot(`${name}.png`, {
    animations: "disabled",
    stylePath: [pageStyle, elementStyle],
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("sign-in", async ({ page }) => {
      await mockSignedInApi(page, { authenticated: false });
      await page.goto("/");
      await expect(page.getByLabel("驗證碼")).toBeVisible();
      await snap(page, `sign-in-${colorScheme}`);
    });

    test("offline page", async ({ page }) => {
      await page.goto("/offline.html");
      await expect(page.getByRole("heading", { name: "Bragi 目前離線" })).toBeVisible();
      await snap(page, `offline-${colorScheme}`);
    });

    test("settings", async ({ page }) => {
      await mockSignedInApi(page);
      await page.goto("/");
      await openSettings(page);
      await snap(page, `settings-${colorScheme}`);
    });

    test("capture", async ({ page }) => {
      await mockSignedInApi(page);
      await page.goto("/");
      await selectImage(page);
      await expect(page.locator(".capture-status").getByRole("status")).toHaveText(
        "圖片已準備完成，可以開始辨識",
      );
      await snap(page, `capture-${colorScheme}`);
    });

    test("review", async ({ page }) => {
      await mockSignedInApi(page);
      await page.goto("/");
      await recognize(page);
      await snap(page, `review-${colorScheme}`);
    });

    test("playback", async ({ page }) => {
      await mockSignedInApi(page);
      await page.goto("/");
      await recognize(page);
      await page.getByRole("button", { name: /^進入朗讀/ }).click();
      await expect(page.getByRole("heading", { name: "第 1 段，共 2 段" })).toBeFocused();
      await snap(page, `playback-${colorScheme}`);
    });
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} C2 screens`, () => {
    test.use({ colorScheme });

    test("capture first screen", async ({ page }) => {
      await mockSignedInApi(page);
      await page.goto("/");
      await expect(page.locator("#capture-heading")).toHaveText("準備下一段故事");
      await snap(page, `capture-entry-${colorScheme}`);
    });

    test("recognizing", async ({ page }) => {
      await mockSignedInApi(page);
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/api/ocr", async (route) => {
        await held;
        await route.fallback();
      });
      await page.goto("/");
      await selectImage(page);
      await page.getByRole("button", { name: "辨識文字", exact: true }).click();
      await expect(page.locator(".recognition-stages [aria-current=step]")).toHaveText(
        "辨識與分段",
      );
      try {
        await snap(page, `recognizing-${colorScheme}`);
      } finally {
        await page.getByRole("button", { name: "取消辨識" }).click();
        release();
      }
    });

    test("empty imported draft", async ({ page }) => {
      await mockSignedInApi(page);
      await page.goto("/");
      await page.locator("#draft-import").setInputFiles({
        name: "empty.json",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({
            format: "bragi-draft",
            version: 1,
            exportedAt: "2026-10-09T00:00:00Z",
            detectedLanguage: "繁體中文",
            segments: [],
          }),
        ),
      });
      await expect(page.getByRole("button", { name: "新增文字段落" })).toBeVisible();
      await snap(page, `empty-draft-${colorScheme}`);
    });

    test("review issue", async ({ page }) => {
      await mockSignedInApi(page);
      await page.goto("/");
      await recognize(page);
      await page.getByLabel("口白文字", { exact: true }).first().fill("");
      await expect(page.getByRole("button", { name: "第 1 段需處理 →" })).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
      await snap(page, `review-issue-${colorScheme}`);
    });
  });
}

for (const locale of ["ja", "de"] as const) {
  test(`${locale} capture and text-only review`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem("bragi-locale", value), locale);
    await mockSignedInApi(page);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await snap(page, `capture-${locale}`);
    await page.locator("#draft-import").setInputFiles({
      name: "text.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          format: "bragi-draft",
          version: 1,
          exportedAt: "2026-10-09T00:00:00Z",
          detectedLanguage: "繁體中文",
          segments: [
            {
              id: "one",
              text: "館員不在櫃檯。桌上攤著一本翻到一半的日記，墨跡還沒乾。",
              suggestedToneHint: "疑惑、壓低聲音",
            },
          ],
        }),
      ),
    });
    await expect(page).toHaveURL(/\/review$/);
    await snap(page, `review-${locale}`);
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} replacement sheets`, () => {
    test.use({ colorScheme });
    for (const action of ["import", "replace"] as const) {
      test(`${action} loss confirmation`, async ({ page }) => {
        await mockSignedInApi(page);
        await page.goto("/");
        await recognize(page);
        await page.getByLabel("口白文字", { exact: true }).first().fill("保留這段舊稿。");
        await goToStep(page, "取圖");
        await selectImage(page);
        if (action === "import")
          await page.locator("#draft-import").setInputFiles(draftFile("匯入的新稿。"));
        else await page.getByRole("button", { name: "辨識文字", exact: true }).click();
        const sheet = page.getByRole("dialog", {
          name: action === "import" ? "匯入草稿？" : "取代目前稿件？",
        });
        await expect(sheet).toBeVisible();
        await snap(page, `loss-${action}-${colorScheme}`);
        const download = page.waitForEvent("download");
        await sheet.getByRole("button", { name: "先匯出，再繼續" }).click();
        await download;
        await snap(page, `loss-${action}-exported-${colorScheme}`);
      });
    }
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} narration states`, () => {
    test.use({ colorScheme });
    for (const target of [
      "loading",
      "playing",
      "paused",
      "interrupted",
      "blocked",
      "error",
      "waiting",
      "complete",
    ] as const) {
      test(`reading ${target}`, async ({ page }) => {
        await mockSignedInApi(page);
        await mockAudio(page);
        await page.addInitScript(() => localStorage.setItem("bragi-playback-rate", "1.5"));
        let release!: () => void;
        if (target === "loading") {
          const held = new Promise<void>((resolve) => {
            release = resolve;
          });
          await page.route("**/api/tts", async (route) => {
            await held;
            await route.fallback();
          });
        }
        if (target === "error")
          await page.route("**/api/tts", (route) =>
            route.fulfill({ status: 503, json: { error: "語音服務暫時無法使用，請重試。" } }),
          );
        await page.goto("/");
        await recognize(page);
        await page.getByRole("button", { name: /^進入朗讀/ }).click();
        await page.evaluate(() => {
          window.audioTest.freezePosition = true;
        });
        if (target === "blocked")
          await page.evaluate(() => {
            window.audioTest.rejectNext = true;
          });
        if (target === "complete")
          await page.getByRole("button", { name: "下一段", exact: true }).click();
        await page.locator(".playback-primary").click();
        if (!["loading", "error", "blocked"].includes(target)) {
          await expect(page.locator(".playback")).toHaveAttribute("data-phase", "playing");
          if (target === "paused") await page.locator(".playback-primary").click();
          if (target === "waiting" || target === "complete")
            await page.evaluate(() => window.audioTest.finish());
          if (target === "interrupted")
            await page.evaluate(() => {
              Object.defineProperty(document, "visibilityState", {
                configurable: true,
                value: "hidden",
              });
              document.dispatchEvent(new Event("visibilitychange"));
            });
        }
        await expect(page.locator(".playback")).toHaveAttribute("data-phase", target);
        await snap(page, `reading-${target}-${colorScheme}`);
        if (target === "loading") release();
      });
    }
    for (const variant of ["unexported", "exported", "partial"] as const) {
      test(`finished ${variant}`, async ({ page }) => {
        await mockSignedInApi(page);
        await mockAudio(page);
        await page.addInitScript(() => localStorage.setItem("bragi-playback-rate", "1.5"));
        await page.goto("/");
        await recognize(page);
        await page.getByRole("button", { name: /^進入朗讀/ }).click();
        if (variant === "partial")
          await page.getByRole("button", { name: "下一段", exact: true }).click();
        await page.locator(".playback-primary").click();
        await expect(page.locator(".playback")).toHaveAttribute("data-phase", "playing");
        await page.evaluate(() => window.audioTest.finish());
        if (variant !== "partial") {
          await expect(page.locator(".playback")).toHaveAttribute("data-phase", "waiting");
          await page.locator(".playback-primary").click();
          await expect(page.locator(".playback")).toHaveAttribute("data-phase", "playing");
          await page.evaluate(() => window.audioTest.finish());
        }
        await expect(page.locator(".playback")).toHaveAttribute("data-phase", "complete");
        await page.locator(".playback-primary").click();
        await expect(page).toHaveURL(/\/finished$/);
        if (variant === "exported") {
          const download = page.waitForEvent("download");
          await page.getByRole("button", { name: "匯出草稿" }).click();
          await download;
        }
        await snap(page, `finished-${variant}-${colorScheme}`);
      });
    }
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} progressive review`, () => {
    test.use({ colorScheme });
    test("compact and expanded card", async ({ page }) => {
      await mockSignedInApi(page);
      await page.goto("/");
      await recognize(page);
      await snapReviewCard(page, `review-compact-${colorScheme}`);
      await page
        .locator(".review-segment")
        .first()
        .getByRole("button", { name: "更多編輯" })
        .click();
      await page.getByRole("button", { name: "另設朗讀文字" }).click();
      await snapReviewCard(page, `review-expanded-${colorScheme}`);
    });
    test("paragraph navigation", async ({ page }) => {
      await mockSignedInApi(page);
      await page.goto("/");
      await page.locator("#draft-import").setInputFiles({
        ...draftFile("unused"),
        buffer: Buffer.from(
          JSON.stringify({
            format: "bragi-draft",
            version: 1,
            exportedAt: "2026-10-09T00:00:00Z",
            detectedLanguage: "繁體中文",
            segments: Array.from({ length: 20 }, (_, i) => ({
              id: `s${i}`,
              text: i === 3 ? "" : `第 ${i + 1} 段的故事，等待逐段校對。`,
              suggestedToneHint: "平靜",
            })),
          }),
        ),
      });
      await expect(page).toHaveURL(/\/review$/);
      if ((page.viewportSize()?.width ?? 0) < 900)
        await page.getByRole("button", { name: "段落列表", exact: true }).click();
      await snap(page, `review-list-${colorScheme}`);
    });
    test("prepared image comparison", async ({ page }) => {
      await mockSignedInApi(page);
      await page.goto("/");
      const buffer = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 900;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas unavailable");
        context.fillStyle = "#f6f1e7";
        context.fillRect(0, 0, 640, 900);
        context.fillStyle = "#2a2119";
        context.font = "bold 36px serif";
        context.fillText("The library at midnight", 42, 80);
        context.font = "24px serif";
        for (const [i, line] of [
          "The streetlights fade, one by one.",
          "You open the side door of the library.",
          "The scent of old paper fills the air.",
          "An unfinished diary lies on the desk.",
          "Its ink has not yet dried.",
        ].entries())
          context.fillText(line, 42, 150 + i * 46);
        return canvas.toDataURL("image/png").split(",")[1] ?? "";
      });
      await page.getByLabel("選擇圖片").setInputFiles({
        name: "library.png",
        mimeType: "image/png",
        buffer: Buffer.from(buffer, "base64"),
      });
      await page.getByRole("button", { name: "辨識文字", exact: true }).click();
      await expect(page).toHaveURL(/\/review$/);
      if ((page.viewportSize()?.width ?? 0) < 900)
        await page.getByRole("button", { name: "查看圖片對照", exact: true }).click();
      await page.getByLabel("圖片放大").selectOption("1.5");
      await page.locator(".comparison-scroller").evaluate((element) => {
        element.scrollTop = 0;
        element.scrollLeft = 0;
      });
      await snap(page, `review-image-${colorScheme}`);
    });
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} toast`, () => {
    test.use({ colorScheme });
    test("confirmation with undo", async ({ page }) => {
      await page.clock.install({ time: new Date("2026-10-09T10:00:00+08:00") });
      await mockSignedInApi(page);
      await page.goto("/");
      await recognize(page);
      await page
        .locator(".review-segment")
        .first()
        .getByRole("button", { name: "更多編輯" })
        .click();
      // With the clock paused the six-second dismissal cannot run, whatever the pointer does.
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
      await page.getByRole("button", { name: "在下方新增" }).click();
      // Let the frame that focuses the new paragraph run; the toast timer stays far away.
      await page.clock.runFor(500);
      await expect(page.locator(".toast")).toContainText("已新增空白段落");
      await expect(page.locator(".toast").getByRole("button", { name: "復原" })).toBeVisible();
      // The page style would remove the toast, so this one capture goes without it.
      await snap(page, `toast-${colorScheme}`, []);
    });
  });
}
