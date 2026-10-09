import { fileURLToPath } from "node:url";
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

// Baselines for the routed screens and shared settings. Animations are off, fonts are the
// system Noto CJK faces and every API response is mocked, so only real visual changes show up.
async function settle(page: Page) {
  // A hidden toast still occupies its original screenshot slot. Hold its dismissal timer
  // so a second export-confirmation picture cannot change height midway through capture.
  // The standalone offline page has no toast.
  if (await page.locator(".toast").count())
    await page.locator(".toast").dispatchEvent("pointerenter");
  await page.evaluate(() => document.fonts.ready);
  // Keep the caret and focus rings out of the pictures.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

async function snap(page: Page, name: string) {
  await settle(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page).toHaveScreenshot(`${name}.png`, {
    // Keep the fixed review action in its real viewport position.
    fullPage: !name.startsWith("review"),
    animations: "disabled",
    stylePath: fileURLToPath(new URL("./visual.css", import.meta.url)),
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
      await page.locator(".toast").evaluate((element) => {
        element.style.visibility = "hidden";
      });
      await snap(page, `review-${colorScheme}`);
    });

    test("playback", async ({ page }) => {
      await mockSignedInApi(page);
      await page.goto("/");
      await recognize(page);
      await page.getByRole("button", { name: /^進入朗讀/ }).click();
      await expect(page.getByRole("heading", { name: "第 1 段，共 2 段" })).toBeFocused();
      await page.locator(".toast").evaluate((element) => {
        element.style.visibility = "hidden";
      });
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
      await page.locator(".toast").evaluate((element) => {
        element.style.visibility = "hidden";
      });
      await snap(page, `empty-draft-${colorScheme}`);
    });

    test("review issue", async ({ page }) => {
      await mockSignedInApi(page);
      await page.goto("/");
      await recognize(page);
      await page.getByLabel("口白文字", { exact: true }).first().fill("");
      await expect(page.getByRole("button", { name: "第 1 段需處理 →" })).toBeVisible();
      await page.locator(".toast").evaluate((element) => {
        element.style.visibility = "hidden";
      });
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
    await page.locator(".toast").evaluate((element) => {
      element.style.visibility = "hidden";
    });
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
        // The recognition toast is not part of these sheets. In full-page shots the static toast
        // takes up space, and whether its six-second timer has run out depends on the run's speed
        // and on whether the pointer happens to rest over it, so take it out of the layout.
        await page.locator(".toast").evaluate((element) => {
          element.style.display = "none";
        });
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
        await page.locator(".toast").evaluate((element) => {
          element.style.visibility = "hidden";
        });
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
        await page.locator(".toast").evaluate((element) => {
          element.style.visibility = "hidden";
        });
        await snap(page, `finished-${variant}-${colorScheme}`);
      });
    }
  });
}
