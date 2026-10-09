import { readFile } from "node:fs/promises";
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
  await page.route(/^https?:\/\/(?!127\.0\.0\.1(?::\d+)?(?:\/|$))/, (route) => route.abort());
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
  await page.getByRole("button", { name: "串流播放第一段" }).click();
  await expect(page.getByRole("button", { name: "重播本段" })).toBeVisible();
  await page.getByLabel("播放速度").selectOption("1.5");
  await page.getByRole("button", { name: /^(繼續|準備)下一段$/ }).click();
  await page.getByRole("button", { name: "播放第 2 段", exact: true }).click();
  await expect
    .poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.playbackRate))
    .toBe(1.5);
  expect(
    await page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.preservesPitch),
  ).toBe(true);
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

test("overlong drafts split safely and editing history survives playback", async ({ page }) => {
  const calls = await mockApi(page, true);
  await page.goto("/");
  await recognize(page);
  await page.getByText("查看圖片對照", { exact: true }).click();
  await expect(page.getByAltText("校對用圖片")).toBeVisible();
  await page.getByLabel("圖片放大").selectOption("2");
  const picture = page.getByAltText("校對用圖片");
  expect(await picture.evaluate((img) => img.getBoundingClientRect().width)).toBeGreaterThan(300);
  const original = page.getByLabel("口白文字", { exact: true }).first();
  const long = "故事開始。".repeat(150);
  await original.fill(long);
  await expect(original).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("button", { name: "開始逐段朗讀" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "產生試聽" }).first()).toBeDisabled();
  expect(calls.filter((c) => c.path === "/api/tts")).toHaveLength(0);
  await page.getByRole("button", { name: "按句自動分段" }).first().click();
  await expect(page.getByRole("button", { name: "開始逐段朗讀" })).toBeEnabled();
  await expect(page.getByLabel("口白文字", { exact: true })).toHaveCount(3);
  await page.getByRole("button", { name: "復原", exact: true }).click();
  await expect(original).toHaveValue(long);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await page.getByRole("button", { name: "開始逐段朗讀" }).click();
  await page.getByRole("button", { name: /返回校對/ }).click();
  await page.getByRole("button", { name: "復原", exact: true }).click();
  await expect(original).toHaveValue(long);
  await page.getByRole("button", { name: "復原", exact: true }).click();
  await expect(original).toHaveValue("故事開始。");
  await original.fill("新版本");
  await expect(page.getByRole("button", { name: "重做", exact: true })).toBeDisabled();
});

test("spoken corrections change synthesis without changing the transcript", async ({ page }) => {
  const calls = await mockApi(page, true);
  await page.goto("/");
  await recognize(page);
  await page.getByRole("button", { name: "另設朗讀文字" }).first().click();
  const spoken = page.getByLabel("朗讀文字（只影響語音）");
  await expect(spoken).toHaveValue("故事開始。");
  await spoken.fill("");
  await expect(spoken).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("button", { name: "開始逐段朗讀" })).toBeDisabled();
  await spoken.fill("故事，開始。");
  await page.getByRole("button", { name: "產生試聽" }).first().click();
  await expect(page.getByLabel("段落試聽")).toBeVisible();
  expect(calls.find((c) => c.path === "/api/tts")?.body).toMatchObject({ text: "故事，開始。" });
  await expect(page.getByLabel("口白文字", { exact: true }).first()).toHaveValue("故事開始。");

  await page.getByRole("button", { name: "開始逐段朗讀" }).click();
  await expect(page.locator(".playback-script")).toContainText("故事開始。");
  await expect(page.locator(".playback-script")).toContainText("朗讀文字：故事，開始。");
  await page.getByRole("button", { name: "串流播放第一段" }).click();
  await expect(page.getByRole("button", { name: "播放第 1 段" })).toBeVisible();
  // The preview already cached the corrected audio, so playback must reuse it.
  expect(calls.filter((c) => c.path === "/api/tts-stream")).toHaveLength(0);

  await page.getByRole("button", { name: /返回校對/ }).click();
  await page.getByRole("button", { name: "改回朗讀口白文字" }).click();
  await expect(page.getByLabel("朗讀文字（只影響語音）")).toHaveCount(0);
  await page.getByRole("button", { name: "開始逐段朗讀" }).click();
  await page.getByRole("button", { name: "串流播放第一段" }).click();
  await expect(page.getByRole("button", { name: "重播本段" })).toBeVisible();
  expect(calls.find((c) => c.path === "/api/tts-stream")?.body).toMatchObject({
    text: "故事開始。",
  });
});

test("drafts export text only and import without an image or provider call", async ({ page }) => {
  const calls = await mockApi(page, true);
  await page.goto("/");
  await recognize(page);
  await page.getByLabel("朗讀語氣").first().fill("低沉");
  await page.getByRole("button", { name: "另設朗讀文字" }).nth(1).click();
  await page.getByLabel("朗讀文字（只影響語音）").fill("門，打開了。");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "匯出草稿" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^bragi-draft-\d{8}-\d{4}\.json$/);
  const exported = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(exported).toMatchObject({
    format: "bragi-draft",
    version: 1,
    detectedLanguage: "繁體中文",
    segments: [
      { id: "one", text: "故事開始。", suggestedToneHint: "低沉" },
      { id: "two", text: "門打開了。", suggestedToneHint: "期待", spokenText: "門，打開了。" },
    ],
  });
  expect(Object.keys(exported).sort()).toEqual(
    ["detectedLanguage", "exportedAt", "format", "segments", "version"].sort(),
  );

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "清除目前內容" }).click();
  await expect(page.getByRole("heading", { name: "3. 校對辨識草稿" })).toHaveCount(0);
  await page.getByLabel("匯入草稿 JSON").setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...exported, version: 2 })),
  });
  await expect(page.getByRole("alert")).toContainText("不支援這個版本");

  const before = calls.length;
  await page.getByLabel("匯入草稿 JSON").setInputFiles({
    name: "draft.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await expect(page.getByText("已匯入草稿 · 2 個段落")).toBeVisible();
  await expect(page.getByLabel("口白文字", { exact: true }).nth(1)).toHaveValue("門打開了。");
  await expect(page.getByLabel("朗讀文字（只影響語音）")).toHaveValue("門，打開了。");
  await expect(page.getByLabel("朗讀語氣").first()).toHaveValue("低沉");
  await expect(page.getByText("查看圖片對照")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "復原", exact: true })).toBeDisabled();
  expect(calls.slice(before)).toHaveLength(0);
});

test("streamed playback recovers after the system suspends audio", async ({ page }) => {
  await mockApi(page, true);
  await page.addInitScript(() => {
    const contexts: AudioContext[] = [];
    Object.assign(window, { bragiContexts: contexts });
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) {
        super(options);
        contexts.push(this);
      }
    };
  });
  // Five seconds of audio keeps the segment playing while the interruption happens.
  await page.route("**/api/tts-stream", (route) =>
    route.fulfill({
      contentType: "audio/l16",
      headers: { "x-audio-sample-rate": "24000" },
      body: Buffer.alloc(240_000),
    }),
  );
  await page.goto("/");
  await recognize(page);
  await page.getByRole("button", { name: "開始逐段朗讀" }).click();
  await page.getByRole("button", { name: "串流播放第一段" }).click();
  await expect(page.getByRole("button", { name: "暫停" })).toBeVisible();

  await page.evaluate(() =>
    (window as unknown as { bragiContexts: AudioContext[] }).bragiContexts.at(-1)?.suspend(),
  );
  await expect(page.getByRole("button", { name: "繼續播放" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("播放被系統中斷");

  await page.getByRole("button", { name: "繼續播放" }).click();
  await expect(page.getByRole("button", { name: "暫停" })).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { bragiContexts: AudioContext[] }).bragiContexts.at(-1)?.state,
    ),
  ).toBe("running");

  await page.getByRole("button", { name: "暫停" }).click();
  await expect(page.getByRole("button", { name: "繼續播放" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("keeps the screen awake during playback only when chosen", async ({ page }) => {
  await mockApi(page, true);
  await page.addInitScript(() => {
    const log: string[] = [];
    Object.assign(window, { bragiWakeLog: log });
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        async request(type: string) {
          log.push(`request:${type}`);
          const sentinel = {
            released: false,
            async release() {
              sentinel.released = true;
              log.push("release");
            },
            addEventListener() {},
          };
          return sentinel;
        },
      },
    });
  });
  const wakeLog = () =>
    page.evaluate(() => (window as unknown as { bragiWakeLog: string[] }).bragiWakeLog);
  await page.goto("/");
  await recognize(page);
  await page.getByRole("button", { name: "開始逐段朗讀" }).click();
  const toggle = page.getByLabel("朗讀時保持螢幕常亮");
  await expect(toggle).not.toBeChecked();
  expect(await wakeLog()).toEqual([]);

  await toggle.check();
  await expect.poll(wakeLog).toEqual(["request:screen"]);
  await page.getByRole("button", { name: /返回校對/ }).click();
  await expect.poll(wakeLog).toEqual(["request:screen", "release"]);

  await page.getByRole("button", { name: "開始逐段朗讀" }).click();
  await expect(page.getByLabel("朗讀時保持螢幕常亮")).toBeChecked();
  await expect.poll(wakeLog).toEqual(["request:screen", "release", "request:screen"]);
});

test("non-1× speeds skip streaming and keep the original pitch", async ({ page }) => {
  const calls = await mockApi(page, true);
  await page.goto("/");
  await recognize(page);
  await page.getByRole("button", { name: "開始逐段朗讀" }).click();
  await page.getByLabel("播放速度").selectOption("0.75");
  await expect(page.getByText("非 1 倍速會先產生整段音訊再播放")).toBeVisible();
  await page.getByRole("button", { name: "播放第一段" }).click();
  await page.getByRole("button", { name: "播放第 1 段", exact: true }).click();
  await expect
    .poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.playbackRate))
    .toBe(0.75);
  expect(
    await page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.preservesPitch),
  ).toBe(true);
  expect(calls.filter((call) => call.path === "/api/tts-stream")).toHaveLength(0);
  expect(calls.filter((call) => call.path === "/api/tts").length).toBeGreaterThan(0);
});

test("voice picker labels voices, samples them and remembers the choice", async ({ page }) => {
  const calls = await mockApi(page, true);
  await page.goto("/");
  const picker = page.getByLabel("朗讀聲音");
  await expect(picker.locator("option")).toHaveText(["預設聲音（Kore · 堅定）", "Puck · 輕快"]);

  await page.getByRole("button", { name: "試聽這個聲音" }).click();
  await expect(page.getByLabel("聲音試聽")).toBeVisible();
  expect(calls.filter((c) => c.path === "/api/tts").at(-1)?.body).toMatchObject({
    voice: "Kore",
    text: "夜色降臨，古老的城門在眾人面前緩緩開啟。",
  });

  await picker.selectOption("Puck");
  await expect(page.getByLabel("聲音試聽")).toHaveCount(0);
  await page.getByRole("button", { name: "試聽這個聲音" }).click();
  await expect(page.getByLabel("聲音試聽")).toBeVisible();
  expect(calls.filter((c) => c.path === "/api/tts").at(-1)?.body).toMatchObject({ voice: "Puck" });

  // Returning to a voice that was already sampled reuses its audio.
  await picker.selectOption("");
  await page.getByRole("button", { name: "試聽這個聲音" }).click();
  expect(calls.filter((c) => c.path === "/api/tts")).toHaveLength(2);

  await picker.selectOption("Puck");
  await page.reload();
  await expect(page.getByLabel("朗讀聲音")).toHaveValue("Puck");
});

test("reading presets increase actual narration and editor font sizes", async ({ page }) => {
  await mockApi(page, true);
  await page.goto("/");
  await recognize(page);
  const editorSizes: number[] = [];
  for (const preset of ["normal", "large", "largest"]) {
    await page.getByLabel("朗讀字級").selectOption(preset);
    editorSizes.push(
      await page
        .getByLabel("口白文字", { exact: true })
        .first()
        .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
    );
  }
  await page.getByRole("button", { name: "開始逐段朗讀" }).click();
  const scriptSizes: number[] = [];
  for (const preset of ["normal", "large", "largest"]) {
    await page.getByLabel("朗讀字級").selectOption(preset);
    scriptSizes.push(
      await page
        .locator(".playback-script p")
        .first()
        .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
    );
  }
  expect(scriptSizes).toEqual(editorSizes);
  expect(scriptSizes[1]).toBeGreaterThan(scriptSizes[0] ?? 0);
  expect(scriptSizes[2]).toBeGreaterThan(scriptSizes[1] ?? 0);
});

test("50-segment drafts disable insertion and splitting and reject oversized edits", async ({
  page,
}) => {
  await mockApi(page, true);
  await page.goto("/");
  const draft = {
    format: "bragi-draft",
    version: 1,
    exportedAt: new Date().toISOString(),
    detectedLanguage: "zh",
    segments: Array.from({ length: 50 }, (_, i) => ({
      id: `s${i}`,
      text: "故事開始。",
      suggestedToneHint: "",
    })),
  };
  await page.getByLabel("匯入草稿 JSON").setInputFiles({
    name: "50.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(draft)),
  });
  await expect(page.getByLabel("口白文字", { exact: true })).toHaveCount(50);
  for (const name of ["新增段落", "從游標分割", "在下方新增", "按句自動分段"])
    await expect(page.getByRole("button", { name, exact: true }).first()).toBeDisabled();
  await expect(page.locator("#draft-limit-note")).toContainText("50 個段落");
  await page.getByLabel("口白文字", { exact: true }).first().fill("😀".repeat(10_001));
  await expect(page.getByRole("alert")).toContainText("欄位限制");
  await expect(page.getByLabel("口白文字", { exact: true }).first()).toHaveValue("故事開始。");
  await page.getByRole("button", { name: "刪除段落 50", exact: true }).click();
  await expect(page.getByRole("button", { name: "新增段落", exact: true })).toBeEnabled();
});

test("new photos preserve the draft, language, genre, comparison and undo until confirmed", async ({
  page,
}) => {
  await mockApi(page, true);
  await page.goto("/");
  await recognize(page);
  await page.getByLabel("口白文字", { exact: true }).first().fill("保留這段修改。");
  await page.getByLabel("題材提示（選填）").fill("舊題材");
  await page.getByText("查看圖片對照").click();
  const oldImage = await page.getByAltText("校對用圖片").getAttribute("src");
  await page
    .getByLabel("從相簿選擇")
    .setInputFiles({ name: "candidate.png", mimeType: "image/png", buffer: image });
  await expect(page.getByAltText("準備上傳的圖片預覽")).toBeVisible();
  await page.getByLabel("題材提示（選填）").fill("候選題材");
  await expect(page.getByLabel("口白文字", { exact: true })).toHaveCount(2);
  await expect(page.getByLabel("口白文字", { exact: true }).first()).toHaveValue("保留這段修改。");
  await expect(page.getByRole("button", { name: "復原", exact: true })).toBeEnabled();
  expect(await page.getByAltText("校對用圖片").getAttribute("src")).toBe(oldImage);
  await page.getByRole("button", { name: "取消候選圖片" }).click();
  await expect(page.getByLabel("題材提示（選填）")).toHaveValue("舊題材");

  await page
    .getByLabel("從相簿選擇")
    .setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: Buffer.from("broken") });
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("口白文字", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "復原", exact: true })).toBeEnabled();

  await page
    .getByLabel("從相簿選擇")
    .setInputFiles({ name: "candidate.png", mimeType: "image/png", buffer: image });
  await page.route("**/api/ocr", (route) =>
    route.fulfill({ status: 502, json: { error: "辨識暫時失敗" } }),
  );
  await page.getByRole("button", { name: "上傳並辨識文字", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("口白文字", { exact: true })).toHaveCount(2);
  await expect(page.getByAltText("準備上傳的圖片預覽")).toBeVisible();
  await expect(page.getByRole("button", { name: "復原", exact: true })).toBeEnabled();

  await page.route("**/api/ocr", (route) =>
    route.fulfill({
      json: {
        detectedLanguage: "English",
        segments: [{ id: "new", text: "A new story.", suggestedToneHint: "" }],
      },
    }),
  );
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "上傳並辨識文字", exact: true }).click();
  await expect(page.getByText("已保留目前稿件；候選圖片可重新辨識")).toBeVisible();
  await expect(page.getByLabel("口白文字", { exact: true }).first()).toHaveValue("保留這段修改。");
  await expect(page.getByRole("button", { name: "復原", exact: true })).toBeEnabled();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "上傳並辨識文字", exact: true }).click();
  await expect(page.getByText("辨識完成 · 1 個段落")).toBeVisible();
  await expect(page.getByLabel("口白文字", { exact: true })).toHaveCount(1);
  await expect(page.getByLabel("口白文字", { exact: true })).toHaveValue("A new story.");
  await expect(page.getByText("主要語言：English · 1 個段落")).toBeVisible();
  await expect(page.getByRole("button", { name: "復原", exact: true })).toBeDisabled();
});

test("late OCR success and failure cannot restore a cleared workspace or overwrite status", async ({
  page,
}) => {
  await mockApi(page, true);
  await page.addInitScript(() => {
    const originalFetch = window.fetch;
    Object.assign(window, { finishOcr: undefined });
    window.fetch = (input, init) => {
      if (input === "/api/ocr")
        return new Promise<Response>((resolve, reject) => {
          Object.assign(window, {
            finishOcr: (fail: boolean) =>
              fail
                ? reject(new Error("late failure"))
                : resolve(
                    new Response(
                      JSON.stringify({
                        detectedLanguage: "zh",
                        segments: [{ id: "late", text: "遲到結果", suggestedToneHint: "" }],
                      }),
                      { headers: { "content-type": "application/json" } },
                    ),
                  ),
          });
        });
      return originalFetch(input, init);
    };
  });
  await page.goto("/");
  for (const fail of [false, true]) {
    await page
      .getByLabel("從相簿選擇")
      .setInputFiles({ name: "card.png", mimeType: "image/png", buffer: image });
    await page.getByRole("button", { name: "上傳並辨識文字", exact: true }).click();
    await expect(page.getByText("Gemini 正在辨識與分段…")).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "清除目前內容" }).click();
    await page.evaluate(
      (fail) => (window as unknown as { finishOcr: (fail: boolean) => void }).finishOcr(fail),
      fail,
    );
    await expect(page.getByText("已清除目前內容，登入狀態已保留")).toBeVisible();
    await expect(page.getByLabel("口白文字", { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("bragi:autosave:v1"))).toBeNull();
  }
});

test("late import cannot replace a newer image and invalid import preserves edits", async ({
  page,
}) => {
  await mockApi(page, true);
  await page.addInitScript(() => {
    const originalText = File.prototype.text;
    File.prototype.text = function () {
      if (this.name !== "late.json") return originalText.call(this);
      return new Promise<string>((resolve) => {
        Object.assign(window, { finishImport: resolve });
      });
    };
  });
  await page.goto("/");
  await recognize(page);
  await page.getByLabel("口白文字", { exact: true }).first().fill("保留舊稿。");
  await page
    .getByLabel("匯入草稿 JSON")
    .setInputFiles({ name: "late.json", mimeType: "application/json", buffer: Buffer.from("{}") });
  await expect
    .poll(() =>
      page.evaluate(() => typeof (window as unknown as { finishImport: unknown }).finishImport),
    )
    .toBe("function");
  await page
    .getByLabel("從相簿選擇")
    .setInputFiles({ name: "new.png", mimeType: "image/png", buffer: image });
  await expect(page.getByAltText("準備上傳的圖片預覽")).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { finishImport: (source: string) => void }).finishImport("{"),
  );
  await expect(page.getByText("圖片已準備完成，可以開始辨識")).toBeVisible();
  await expect(page.getByLabel("口白文字", { exact: true }).first()).toHaveValue("保留舊稿。");
  await page
    .getByLabel("匯入草稿 JSON")
    .setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from("{") });
  await expect(page.getByRole("alert")).toContainText("JSON");
  await expect(page.getByLabel("口白文字", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "復原", exact: true })).toBeEnabled();
});

test("late image preparation and successful import cannot write after clear", async ({ page }) => {
  await mockApi(page, true);
  await page.addInitScript(() => {
    const originalBitmap = window.createImageBitmap;
    window.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) => {
      if ((args[0] as File).name !== "slow.png") return originalBitmap(...args);
      return new Promise<ImageBitmap>((_resolve, reject) => {
        Object.assign(window, { failImage: reject });
      });
    }) as typeof createImageBitmap;
    const originalText = File.prototype.text;
    File.prototype.text = function () {
      if (this.name !== "slow.json") return originalText.call(this);
      return new Promise<string>((resolve) => {
        Object.assign(window, { finishImport: resolve });
      });
    };
  });
  await page.goto("/");
  await recognize(page);
  await page
    .getByLabel("從相簿選擇")
    .setInputFiles({ name: "slow.png", mimeType: "image/png", buffer: image });
  await expect(page.getByText("正在調整方向與圖片大小…")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "清除目前內容" }).click();
  await page.evaluate(() =>
    (window as unknown as { failImage: (error: Error) => void }).failImage(
      new Error("late image error"),
    ),
  );
  await expect(page.getByText("已清除目前內容，登入狀態已保留")).toBeVisible();
  await expect(page.getByRole("button", { name: "上傳並辨識文字", exact: true })).toBeDisabled();

  await page
    .getByLabel("匯入草稿 JSON")
    .setInputFiles({ name: "slow.json", mimeType: "application/json", buffer: Buffer.from("{}") });
  await expect
    .poll(() =>
      page.evaluate(() => typeof (window as unknown as { finishImport: unknown }).finishImport),
    )
    .toBe("function");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "清除目前內容" }).click();
  await page.evaluate(() =>
    (window as unknown as { finishImport: (source: string) => void }).finishImport(
      JSON.stringify({
        format: "bragi-draft",
        version: 1,
        exportedAt: new Date().toISOString(),
        detectedLanguage: "zh",
        segments: [{ id: "late", text: "遲到匯入", suggestedToneHint: "" }],
      }),
    ),
  );
  await expect(page.getByLabel("口白文字", { exact: true })).toHaveCount(0);
  await expect(page.getByText("已清除目前內容，登入狀態已保留")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("bragi:autosave:v1"))).toBeNull();
});

test("new photos invalidate pending voice and segment preview errors", async ({ page }) => {
  await mockApi(page, true);
  await page.addInitScript(() => {
    const originalFetch = window.fetch;
    window.fetch = (input, init) => {
      if (input === "/api/tts")
        return new Promise<Response>((_resolve, reject) => {
          Object.assign(window, { rejectSpeech: () => reject(new Error("late speech failure")) });
        });
      return originalFetch(input, init);
    };
  });
  await page.goto("/");
  await recognize(page);
  for (const name of ["試聽這個聲音", "產生試聽"]) {
    await page.getByRole("button", { name, exact: true }).first().click();
    await expect
      .poll(() =>
        page.evaluate(() => typeof (window as unknown as { rejectSpeech: unknown }).rejectSpeech),
      )
      .toBe("function");
    await page
      .getByLabel("從相簿選擇")
      .setInputFiles({ name: "new.png", mimeType: "image/png", buffer: image });
    await expect(page.getByText("圖片已準備完成，可以開始辨識")).toBeVisible();
    await page.evaluate(() => (window as unknown as { rejectSpeech: () => void }).rejectSpeech());
    await expect(page.getByText("圖片已準備完成，可以開始辨識")).toBeVisible();
    await expect(page.getByLabel("口白文字", { exact: true })).toHaveCount(2);
  }
});

test("autosave restores only text after reload, and clear or logout removes it", async ({
  page,
}) => {
  const calls = await mockApi(page, true);
  await page.goto("/");
  await recognize(page);
  await page.getByLabel("口白文字", { exact: true }).first().fill("重新整理後仍保留。");
  await page.getByRole("button", { name: "另設朗讀文字" }).first().click();
  await page.getByLabel("朗讀文字（只影響語音）").fill("重新整理，仍保留。");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("bragi:autosave:v1") ?? "{}").segments?.[0]?.spokenText,
      ),
    )
    .toBe("重新整理，仍保留。");
  await page.reload();
  await expect(page.getByRole("button", { name: "恢復上次的草稿" })).toBeVisible();
  await expect(page.getByLabel("口白文字", { exact: true })).toHaveCount(0);
  const before = calls.filter((call) => call.path !== "/api/session").length;
  await page.getByRole("button", { name: "恢復上次的草稿" }).click();
  await expect(page.getByLabel("口白文字", { exact: true }).first()).toHaveValue(
    "重新整理後仍保留。",
  );
  await expect(page.getByLabel("朗讀文字（只影響語音）")).toHaveValue("重新整理，仍保留。");
  await expect(page.getByText("查看圖片對照")).toHaveCount(0);
  expect(calls.filter((call) => call.path !== "/api/session")).toHaveLength(before);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "清除目前內容" }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("bragi:autosave:v1")))
    .toBeNull();
  await page.reload();
  await expect(page.getByRole("button", { name: "恢復上次的草稿" })).toHaveCount(0);
  await recognize(page);
  await page.getByRole("button", { name: "登出", exact: true }).click();
  await expect(page.getByRole("button", { name: "登入", exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("bragi:autosave:v1")))
    .toBeNull();
});

test("saved drafts require a choice and discard or malformed data removes the local copy", async ({
  page,
}) => {
  await mockApi(page, true);
  await page.goto("/");
  await recognize(page);
  await page.reload();
  await expect(page.getByRole("button", { name: "恢復上次的草稿" })).toBeVisible();
  await page.getByRole("button", { name: "捨棄", exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem("bragi:autosave:v1"))).toBeNull();
  await page.evaluate(() => localStorage.setItem("bragi:autosave:v1", "{"));
  await page.reload();
  await expect(page.getByRole("button", { name: "恢復上次的草稿" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "登出", exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("bragi:autosave:v1"))).toBeNull();
});
