import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import {
  draftFile,
  goToStep,
  mockSignedInApi,
  openComparison,
  recognize,
  segments,
  selectImage,
} from "./fixtures";

const title = (action: "import" | "replace") =>
  action === "import" ? "匯入草稿？" : "取代目前稿件？";
async function begin(page: Page, action: "import" | "replace") {
  if (action === "import")
    await page.locator("#draft-import").setInputFiles(draftFile("匯入的新稿。"));
  else await page.getByRole("button", { name: "辨識文字", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: title(action) });
  await expect(sheet).toBeVisible();
  return sheet;
}
async function oldContent(page: Page) {
  await mockSignedInApi(page);
  // Any accidental reintroduction of native confirm fails instead of silently accepting it.
  page.on("dialog", () => {
    throw new Error("Unexpected native dialog");
  });
  await page.goto("/");
  await recognize(page);
  await page.getByLabel("口白文字", { exact: true }).first().fill("保留這段舊稿。");
  await goToStep(page, "取圖");
  await selectImage(page);
}

for (const action of ["import", "replace"] as const) {
  test(`${action} exports the old draft and replaces only after the separate continue button`, async ({
    page,
  }) => {
    await oldContent(page);
    const sheet = await begin(page, action);
    const download = page.waitForEvent("download");
    await sheet.getByRole("button", { name: "先匯出，再繼續" }).click();
    const exported = JSON.parse(await readFile(await (await download).path(), "utf8"));
    expect(exported.segments[0]?.text ?? "").toBe("保留這段舊稿。");
    await expect(sheet).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByAltText("準備上傳的圖片預覽")).toBeVisible();
    const continuation = sheet.getByRole("button", {
      name: action === "import" ? "繼續匯入" : "繼續取代",
      exact: true,
    });
    await expect(continuation).toBeFocused();
    await continuation.click();
    await expect(page).toHaveURL(/\/review$/);
    await expect(page.getByLabel("口白文字", { exact: true }).first()).toHaveValue(
      action === "import" ? "匯入的新稿。" : (segments[0]?.text ?? ""),
    );
    await expect(
      page.locator("#main").getByRole("button", { name: "復原", exact: true }),
    ).toBeDisabled();
    if (action === "replace") {
      await openComparison(page);
      await expect(page.getByAltText("校對用圖片")).toBeVisible();
    } else await expect(page.locator(".review-no-image")).toBeVisible();
  });

  test(`${action} cancel preserves the old edits and candidate image for retry`, async ({
    page,
  }) => {
    await oldContent(page);
    const sheet = await begin(page, action);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(page.getByAltText("準備上傳的圖片預覽")).toBeVisible();
    await expect(page.getByRole("button", { name: "辨識文字", exact: true })).toBeEnabled();
    await goToStep(page, "校對");
    await expect(page.getByLabel("口白文字", { exact: true }).first()).toHaveValue(
      "保留這段舊稿。",
    );
    await expect(
      page.locator("#main").getByRole("button", { name: "復原", exact: true }),
    ).toBeEnabled();
    await goToStep(page, "取圖");
    const retry = await begin(page, action);
    await retry
      .getByRole("button", { name: action === "import" ? "不匯出，直接匯入" : "不匯出，直接取代" })
      .click();
    await expect(page).toHaveURL(/\/review$/);
  });

  for (const newer of ["clear", "signOut", "import", "candidate"] as const) {
    test(`${action} waiting result cannot commit after ${newer} supersedes it`, async ({
      page,
    }) => {
      await oldContent(page);
      const previous = await begin(page, action);
      if (newer === "import") {
        const download = page.waitForEvent("download");
        await previous.getByRole("button", { name: "先匯出，再繼續" }).click();
        await download;
      }
      // Exercise controller invalidation while the modal is open. Native dialog makes user
      // clicks outside inert, so trigger the same existing UI handlers programmatically.
      if (newer === "import") {
        await page
          .locator("#draft-import")
          .setInputFiles(draftFile("更新的匯入稿。", "latest.json"));
        const sheet = page.getByRole("dialog", { name: "匯入草稿？" });
        await expect(sheet).toBeVisible();
        await expect(sheet.getByRole("button", { name: "先匯出，再繼續" })).toBeVisible();
        await expect(sheet.getByRole("button", { name: "繼續匯入", exact: true })).toHaveCount(0);
        await sheet.getByRole("button", { name: "不匯出，直接匯入" }).click();
        await expect(page.getByLabel("口白文字", { exact: true })).toHaveValue("更新的匯入稿。");
      } else if (newer === "candidate") {
        await page.getByLabel("選擇圖片").setInputFiles({
          ...draftFile("unused"),
          name: "broken.png",
          mimeType: "image/png",
          buffer: Buffer.from("broken"),
        });
        await expect(page.getByRole("dialog", { name: title(action) })).toBeHidden();
        await expect(page.locator(".capture-preview .file")).toContainText("broken.png");
        await goToStep(page, "校對");
        await expect(page.getByLabel("口白文字", { exact: true }).first()).toHaveValue(
          "保留這段舊稿。",
        );
      } else {
        await page
          .getByRole("button", { name: "設定", exact: true })
          .evaluate((button: HTMLButtonElement) => button.click());
        await page
          .getByRole("dialog", { name: "設定", exact: true })
          .getByRole("button", { name: newer === "clear" ? "清除目前內容" : "登出", exact: true })
          .click();
        const sheet = page.getByRole("dialog", {
          name: newer === "clear" ? "清除目前內容？" : "登出？",
          exact: true,
        });
        await sheet
          .getByRole("button", {
            name: newer === "clear" ? "不匯出，直接清除" : "不匯出，直接登出",
          })
          .click();
        await expect(page).toHaveURL(/\/$/);
        await expect(page.getByLabel("口白文字", { exact: true })).toHaveCount(0);
        expect(await page.evaluate(() => localStorage.getItem("bragi:autosave:v1"))).toBeNull();
        if (newer === "signOut") await expect(page.getByLabel("驗證碼")).toBeVisible();
      }
      await expect(page.getByRole("dialog", { name: "取代目前稿件？" })).toBeHidden();
      await expect(page.getByRole("dialog", { name: "匯入草稿？" })).toBeHidden();
    });
  }
}

test("import asks when only a candidate image would be lost, with no export button", async ({
  page,
}) => {
  await mockSignedInApi(page);
  await page.goto("/");
  await selectImage(page);
  const sheet = await begin(page, "import");
  await expect(sheet.getByRole("button", { name: "先匯出，再繼續" })).toHaveCount(0);
  await sheet.getByRole("button", { name: "取消", exact: true }).last().click();
  await expect(page.getByAltText("準備上傳的圖片預覽")).toBeVisible();
});

test("empty workspace import and first recognition submit without a loss question", async ({
  page,
}) => {
  await mockSignedInApi(page);
  await page.goto("/");
  await page.locator("#draft-import").setInputFiles(draftFile("直接匯入。"));
  await expect(page.getByLabel("口白文字", { exact: true })).toHaveValue("直接匯入。");
  await expect(page.getByRole("dialog", { name: "匯入草稿？" })).toBeHidden();
  await page.evaluate(() => localStorage.clear());
  await page.goto("/");
  await recognize(page);
  await expect(page.getByRole("dialog", { name: "取代目前稿件？" })).toBeHidden();
});
