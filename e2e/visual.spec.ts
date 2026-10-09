import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { mockSignedInApi, recognize, selectImage } from "./fixtures";

// Baselines for the current screens before the C/D redesign. Animations are off, fonts are the
// system Noto CJK faces and every API response is mocked, so only real visual changes show up.
async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  // Keep the caret and focus rings out of the pictures.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

async function snap(page: Page, name: string) {
  await settle(page);
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: true,
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
      await expect(page.getByRole("status")).toHaveText("請先使用 Authenticator 驗證碼登入");
      await snap(page, `sign-in-${colorScheme}`);
    });

    test("capture", async ({ page }) => {
      await mockSignedInApi(page);
      await page.goto("/");
      await selectImage(page);
      await expect(page.getByRole("status")).toHaveText("圖片已準備完成，可以開始辨識");
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
      await page.getByRole("button", { name: "開始逐段朗讀" }).click();
      await expect(page.getByRole("heading", { name: "第 1 段，共 2 段" })).toBeFocused();
      await snap(page, `playback-${colorScheme}`);
    });
  });
}
