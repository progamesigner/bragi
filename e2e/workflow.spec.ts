import { expect, type Page, test } from "@playwright/test";
import { pcmToWav } from "../src/lib/wav";

const pcm = Buffer.alloc(12_000);
const wav = Buffer.from(pcmToWav(pcm));
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC",
  "base64",
);

async function mockApi(page: Page, authenticated = false) {
  const calls: { path: string; body: unknown }[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body = request.headers()["content-type"]?.includes("application/json")
      ? request.postDataJSON()
      : undefined;
    calls.push({ path, body });
    switch (path) {
      case "/api/session":
        if (request.method() === "POST") authenticated = true;
        if (request.method() === "DELETE") authenticated = false;
        return route.fulfill({
          json: { authenticated, voices: authenticated ? ["Kore", "Puck"] : [] },
        });
      case "/api/uploads":
        return route.fulfill({
          json: {
            uploadId: "test-upload",
            target: { url: "/api/upload-content", method: "POST", headers: {} },
            expiresAt: "2099-01-01T00:00:00Z",
          },
        });
      case "/api/upload-content":
        expect(request.postDataBuffer()?.length).toBeGreaterThan(0);
        return route.fulfill({ json: { file: { name: "files/test" } } });
      case "/api/ocr":
        return route.fulfill({
          json: {
            detectedLanguage: "繁體中文",
            segments: [
              { id: "one", text: "故事開始。", suggestedToneHint: "平靜" },
              { id: "two", text: "門打開了。", suggestedToneHint: "期待" },
            ],
          },
        });
      case "/api/tts-stream":
        return route.fulfill({
          contentType: "audio/l16",
          headers: { "x-audio-sample-rate": "24000" },
          body: pcm,
        });
      case "/api/tts":
        return route.fulfill({
          contentType: "audio/wav",
          headers: { "x-audio-duration-ms": "250" },
          body: wav,
        });
      default:
        throw new Error(`Unexpected API request: ${request.method()} ${path}`);
    }
  });
  // No browser traffic may escape to an external provider.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173(?:\/|$))/, (route) => route.abort());
  return calls;
}

async function recognize(page: Page) {
  await page
    .getByLabel("從相簿選擇")
    .setInputFiles({ name: "card.png", mimeType: "image/png", buffer: image });
  await page.getByRole("button", { name: "上傳並辨識文字", exact: true }).click();
  await expect(page.getByRole("heading", { name: "3. 校對辨識草稿" })).toBeFocused();
}

test("font preference persists and selected voice follows both speech paths", async ({ page }) => {
  const calls = await mockApi(page, true);
  await page.goto("/");
  await page.getByLabel("朗讀字級").selectOption("largest");
  await page.reload();
  await expect(page.getByLabel("朗讀字級")).toHaveValue("largest");
  await page.getByLabel("朗讀聲音").selectOption("Puck");
  await recognize(page);
  await page.getByRole("button", { name: "開始逐段朗讀" }).click();
  await page.getByLabel("播放速度").selectOption("1.5");
  await page.getByRole("button", { name: "串流播放第一段" }).click();
  await expect(page.getByRole("button", { name: "重播本段" })).toBeVisible();
  await page.getByRole("button", { name: /^(繼續|準備)下一段$/ }).click();
  await page.getByRole("button", { name: "播放第 2 段", exact: true }).click();
  await expect
    .poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.playbackRate))
    .toBe(1.5);
  expect(calls.find((call) => call.path === "/api/tts-stream")?.body).toMatchObject({
    voice: "Puck",
  });
  expect(calls.find((call) => call.path === "/api/tts")?.body).toMatchObject({ voice: "Puck" });
  await page.getByRole("button", { name: "上一段", exact: true }).click();
  await expect(page.getByRole("heading", { name: "第 1 段，共 2 段" })).toBeVisible();
});

test("offline requests wait for a manual retry after reconnecting", async ({ page, context }) => {
  const calls = await mockApi(page, true);
  await page.goto("/");
  await page
    .getByLabel("從相簿選擇")
    .setInputFiles({ name: "card.png", mimeType: "image/png", buffer: image });
  await expect(page.getByRole("button", { name: "上傳並辨識文字", exact: true })).toBeEnabled();
  await context.setOffline(true);
  await expect(page.getByText("目前離線。", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "上傳並辨識文字", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("請連線後手動重試");
  expect(calls.filter((call) => call.path === "/api/uploads")).toHaveLength(0);
  await context.setOffline(false);
  await expect(page.getByText("目前離線。", { exact: false })).toHaveCount(0);
  expect(calls.filter((call) => call.path === "/api/uploads")).toHaveLength(0);
  await page.getByRole("button", { name: "上傳並辨識文字", exact: true }).click();
  await expect(page.getByRole("heading", { name: "3. 校對辨識草稿" })).toBeVisible();
});

test("workspace clear confirms, stops playback and preserves login", async ({ page }) => {
  await mockApi(page, true);
  await page.goto("/");
  await recognize(page);
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "清除目前內容" }).click();
  await expect(page.getByLabel("口白文字", { exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "開始逐段朗讀" }).click();
  await page.getByRole("button", { name: "串流播放第一段" }).click();
  await expect(page.getByRole("button", { name: "重播本段" })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "清除目前內容" }).click();
  await expect(page.getByRole("status")).toContainText("已清除目前內容");
  await expect(page.getByRole("button", { name: "登出", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "上傳並辨識文字", exact: true })).toBeDisabled();
  await expect(page.locator("audio")).toHaveCount(0);
  await expect(page.getByAltText("準備上傳的圖片預覽")).toHaveCount(0);
  await recognize(page);
});

test("clearing an in-flight OCR aborts it without restoring the old draft", async ({ page }) => {
  await mockApi(page, true);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/ocr", async (route) => {
    await held;
    await route.fulfill({
      json: {
        detectedLanguage: "繁體中文",
        segments: [{ id: "late", text: "已清除的草稿", suggestedToneHint: "" }],
      },
    });
  });
  await page.goto("/");
  await page
    .getByLabel("從相簿選擇")
    .setInputFiles({ name: "card.png", mimeType: "image/png", buffer: image });
  const started = page.waitForRequest("**/api/ocr");
  await page.getByRole("button", { name: "上傳並辨識文字", exact: true }).click();
  await started;
  const aborted = page.waitForEvent("requestfailed", (request) =>
    request.url().endsWith("/api/ocr"),
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "清除目前內容" }).click();
  await aborted;
  release();
  await expect(page.getByLabel("口白文字", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "上傳並辨識文字", exact: true })).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("已清除目前內容");
});

test("login, upload, edit, stream, manually continue, return and sign out", async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto("/");
  await page.getByLabel("Authenticator 6 位驗證碼").fill("123456");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await page.getByLabel("題材提示（選填）").fill("奇幻");
  await recognize(page);
  await page.getByLabel("口白文字", { exact: true }).first().fill("修改後的故事。");
  await page.getByRole("button", { name: "開始逐段朗讀" }).click();
  await page.getByRole("button", { name: "串流播放第一段" }).click();
  await expect(page.getByRole("button", { name: "重播本段" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "第 1 段，共 2 段" })).toBeVisible();
  await page.getByRole("button", { name: /^(繼續|準備)下一段$/ }).click();
  await page.getByRole("button", { name: "播放第 2 段", exact: true }).click();
  await expect(page.getByText("全部段落播放完成。", { exact: true })).toBeVisible();
  expect(calls.find((call) => call.path === "/api/tts-stream")?.body).toEqual({
    text: "修改後的故事。",
    toneHint: "平靜",
    genreHint: "奇幻",
  });
  expect(calls.filter((call) => call.path === "/api/tts")).toHaveLength(1);
  await page.getByRole("button", { name: "返回校對" }).click();
  await expect(page.getByLabel("口白文字", { exact: true }).first()).toHaveValue("修改後的故事。");
  await page.getByRole("button", { name: "登出", exact: true }).click();
  await expect(page.getByLabel("Authenticator 6 位驗證碼")).toBeVisible();
  await expect(page.getByLabel("口白文字", { exact: true })).toHaveCount(0);
  await page.getByLabel("Authenticator 6 位驗證碼").fill("123456");
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page.getByRole("button", { name: "上傳並辨識文字", exact: true })).toBeDisabled();
});

test("restores session and blocks playback until empty segments are fixed", async ({ page }) => {
  await mockApi(page, true);
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText("已恢復登入狀態");
  await recognize(page);
  await page.getByLabel("口白文字", { exact: true }).first().fill("");
  await expect(page.getByRole("button", { name: "開始逐段朗讀" })).toBeDisabled();
  await expect(page.getByLabel("口白文字", { exact: true }).first()).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page.getByLabel("口白文字", { exact: true }).first().fill("已修正。");
  await expect(page.getByRole("button", { name: "開始逐段朗讀" })).toBeEnabled();
});

test("OCR failure keeps the image available for explicit retry", async ({ page }) => {
  const calls = await mockApi(page, true);
  await page.route("**/api/ocr", async (route) => {
    await route.fulfill({
      status: 503,
      json: {
        error: {
          code: "OCR_UNAVAILABLE",
          message: "辨識暫時無法使用",
          requestId: "ocr-test",
          retryable: true,
        },
      },
    });
    await page.unroute("**/api/ocr");
  });
  await page.goto("/");
  await page
    .getByLabel("從相簿選擇")
    .setInputFiles({ name: "card.png", mimeType: "image/png", buffer: image });
  await page.getByRole("button", { name: "上傳並辨識文字", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("ocr-test");
  expect(calls.filter((call) => call.path === "/api/uploads")).toHaveLength(1);
  await page.getByRole("button", { name: "上傳並辨識文字", exact: true }).click();
  await expect(page.getByRole("heading", { name: "3. 校對辨識草稿" })).toBeVisible();
});

test("speech failure recovers only after manual retry", async ({ page }) => {
  await mockApi(page, true);
  let attempts = 0;
  await page.route("**/api/tts-stream", async (route) => {
    attempts += 1;
    if (attempts === 1)
      return route.fulfill({
        status: 503,
        json: {
          error: {
            code: "TTS_UNAVAILABLE",
            message: "朗讀暫時無法使用",
            requestId: "tts-test",
            retryable: true,
          },
        },
      });
    return route.fulfill({
      contentType: "audio/l16",
      headers: { "x-audio-sample-rate": "24000" },
      body: pcm,
    });
  });
  await page.goto("/");
  await recognize(page);
  await page.getByRole("button", { name: "開始逐段朗讀" }).click();
  await page.getByRole("button", { name: "串流播放第一段" }).click();
  await expect(page.getByRole("button", { name: "重試本段" })).toBeVisible();
  expect(attempts).toBe(1);
  await page.getByRole("button", { name: "重試本段" }).click();
  await expect(page.getByRole("button", { name: "重播本段" })).toBeVisible();
  expect(attempts).toBe(2);
});
