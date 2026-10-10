import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { pcmToWav } from "../src/lib/wav";
import {
  chooseVoice,
  clearContent,
  closeComparison,
  closeSettings,
  goToStep,
  moreEditing,
  observeAudio,
  openComparison,
  openSettings,
  openVoicePicker,
  signIn,
  signOut,
  toast,
} from "./fixtures";

const pcm = Buffer.alloc(12_000);
const wav = Buffer.from(pcmToWav(pcm));
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC",
  "base64",
);

async function mockApi(page: Page, authenticated = false) {
  await observeAudio(page);
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

async function recognize(page: Page, replace = false) {
  await page
    .getByLabel("選擇圖片")
    .setInputFiles({ name: "card.png", mimeType: "image/png", buffer: image });
  await page.getByRole("button", { name: /^(辨識文字|重新辨識)$/ }).click();
  if (replace)
    await page
      .getByRole("dialog", { name: "取代目前稿件？" })
      .getByRole("button", { name: "不匯出，直接取代" })
      .click();
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByRole("heading", { name: "校對辨識草稿" })).toBeFocused();
}

test("font preference persists and selected voice follows both speech paths", async ({ page }) => {
  const calls = await mockApi(page, true);
  await page.goto("/");
  let settings = await openSettings(page);
  await settings.getByRole("radio", { name: "特大" }).check();
  await page.reload();
  settings = await openSettings(page);
  await expect(settings.getByRole("radio", { name: "特大" })).toBeChecked();
  await chooseVoice(page, "Puck");
  await closeSettings(page);
  await recognize(page);
  await page.getByRole("button", { name: /^進入朗讀/ }).click();
  await page.getByRole("button", { name: "播放此段" }).click();
  await expect(page.getByRole("button", { name: "播放下一段", exact: true })).toBeVisible();
  settings = await openSettings(page);
  await settings.getByRole("radio", { name: "1.5 倍" }).check();
  await closeSettings(page);
  await expect(page.getByText(/下一次播放套用：.*1.5 倍/)).toBeVisible();
  await page.getByRole("button", { name: "播放下一段" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { bragiAudio: HTMLAudioElement }).bragiAudio.playbackRate,
      ),
    )
    .toBe(1.5);
  expect(
    await page.evaluate(
      () => (window as unknown as { bragiAudio: HTMLAudioElement }).bragiAudio.preservesPitch,
    ),
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
    .getByLabel("選擇圖片")
    .setInputFiles({ name: "card.png", mimeType: "image/png", buffer: image });
  await expect(page.getByRole("button", { name: /^(辨識文字|重新辨識)$/ })).toBeEnabled();
  await context.setOffline(true);
  await expect(page.getByText("目前離線。", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: /^(辨識文字|重新辨識)$/ }).click();
  await expect(page.getByRole("alert")).toContainText("請連線後手動重試");
  expect(calls.filter((call) => call.path === "/api/uploads")).toHaveLength(0);
  await context.setOffline(false);
  await expect(page.getByText("目前離線。", { exact: false })).toHaveCount(0);
  expect(calls.filter((call) => call.path === "/api/uploads")).toHaveLength(0);
  await page.getByRole("button", { name: /^(辨識文字|重新辨識)$/ }).click();
  await expect(page.getByRole("heading", { name: "校對辨識草稿" })).toBeVisible();
});

test("workspace clear confirms, stops playback and preserves login", async ({ page }) => {
  await mockApi(page, true);
  await page.goto("/");
  await recognize(page);
  const sheet = await openSettings(page);
  await sheet.getByRole("button", { name: "清除目前內容" }).click();
  await page
    .getByRole("dialog", { name: "清除目前內容？" })
    .getByRole("button", { name: "取消" })
    .last()
    .click();
  await closeSettings(page);
  await expect(page.getByLabel("口白文字", { exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: /^進入朗讀/ }).click();
  await page.getByRole("button", { name: "播放此段" }).click();
  await expect(page.getByRole("button", { name: "播放下一段", exact: true })).toBeVisible();
  await clearContent(page, "proceed");
  await expect(toast(page)).toContainText("已清除目前內容");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: /^(辨識文字|重新辨識)$/ })).toHaveCount(0);
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
    .getByLabel("選擇圖片")
    .setInputFiles({ name: "card.png", mimeType: "image/png", buffer: image });
  const started = page.waitForRequest("**/api/ocr");
  await page.getByRole("button", { name: /^(辨識文字|重新辨識)$/ }).click();
  await started;
  const aborted = page.waitForEvent("requestfailed", (request) =>
    request.url().endsWith("/api/ocr"),
  );
  await clearContent(page, "proceed");
  await aborted;
  release();
  await expect(page.getByLabel("口白文字", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(辨識文字|重新辨識)$/ })).toHaveCount(0);
  await expect(toast(page)).toContainText("已清除目前內容");
});

test("login, upload, edit, stream, manually continue, return and sign out", async ({ page }) => {
  const calls = await mockApi(page);
  await page.goto("/");
  await signIn(page);
  await page.getByLabel("題材提示（選填）").fill("奇幻");
  await recognize(page);
  await page.getByLabel("口白文字", { exact: true }).first().fill("修改後的故事。");
  await page.getByRole("button", { name: /^進入朗讀/ }).click();
  await page.getByRole("button", { name: "播放此段" }).click();
  await expect(page.getByRole("button", { name: "播放下一段", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "第 1 段，共 2 段" })).toBeVisible();
  await page.getByRole("button", { name: "播放下一段" }).click();
  await expect(page.getByRole("button", { name: "完成朗讀", exact: true })).toBeVisible();
  expect(calls.find((call) => call.path === "/api/tts-stream")?.body).toEqual({
    text: "修改後的故事。",
    toneHint: "平靜",
    genreHint: "奇幻",
  });
  expect(calls.filter((call) => call.path === "/api/tts")).toHaveLength(1);
  await page.getByRole("link", { name: "上一頁", exact: true }).click();
  await expect(page.getByLabel("口白文字", { exact: true }).first()).toHaveValue("修改後的故事。");
  await signOut(page, "proceed");
  await expect(page.getByLabel("口白文字", { exact: true })).toHaveCount(0);
  await signIn(page);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: /^(辨識文字|重新辨識)$/ })).toHaveCount(0);
});

test("restores session and blocks playback until empty segments are fixed", async ({ page }) => {
  await mockApi(page, true);
  await page.goto("/");
  await recognize(page);
  await page.getByLabel("口白文字", { exact: true }).first().fill("");
  await expect(page.getByRole("button", { name: /需處理 →$/ })).toBeEnabled();
  // The step bar explains why reading is unavailable, and a direct visit is sent back.
  await expect(page.getByRole("link", { name: "朗讀", exact: true })).toHaveCount(0);
  await page.goto("/play");
  await expect(page).toHaveURL(/\/$/);
  await recognize(page, true);
  await page.getByLabel("口白文字", { exact: true }).first().fill("");
  await page.evaluate(() => history.pushState(null, "", "/play"));
  await page.evaluate(() => dispatchEvent(new PopStateEvent("popstate")));
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByLabel("口白文字", { exact: true }).first()).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page.getByLabel("口白文字", { exact: true }).first().fill("已修正。");
  await expect(page.getByRole("button", { name: /^進入朗讀/ })).toBeEnabled();
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
    .getByLabel("選擇圖片")
    .setInputFiles({ name: "card.png", mimeType: "image/png", buffer: image });
  await page.getByRole("button", { name: /^(辨識文字|重新辨識)$/ }).click();
  await expect(page.getByRole("alert")).toContainText("ocr-test");
  expect(calls.filter((call) => call.path === "/api/uploads")).toHaveLength(1);
  await page.getByRole("button", { name: /^(辨識文字|重新辨識)$/ }).click();
  await expect(page.getByRole("heading", { name: "校對辨識草稿" })).toBeVisible();
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
  await page.getByRole("button", { name: /^進入朗讀/ }).click();
  await page.getByRole("button", { name: "播放此段" }).click();
  await expect(page.getByRole("button", { name: "重試本段" })).toBeVisible();
  expect(attempts).toBe(1);
  await page.getByRole("button", { name: "重試本段" }).click();
  await expect(page.getByRole("button", { name: "播放下一段", exact: true })).toBeVisible();
  expect(attempts).toBe(2);
});

test("overlong drafts split safely and editing history survives playback", async ({ page }) => {
  const calls = await mockApi(page, true);
  await page.goto("/");
  await recognize(page);
  await openComparison(page);
  await expect(page.getByAltText("校對用圖片")).toBeVisible();
  await page.getByLabel("圖片放大").selectOption("2");
  const picture = page.getByAltText("校對用圖片");
  expect(await picture.evaluate((img) => img.getBoundingClientRect().width)).toBeGreaterThan(300);
  await closeComparison(page);
  const original = page.getByLabel("口白文字", { exact: true }).first();
  const long = "故事開始。".repeat(150);
  await original.fill(long);
  await expect(original).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("button", { name: /需處理 →$/ })).toBeEnabled();
  await expect(page.getByRole("button", { name: "產生試聽" }).first()).toBeDisabled();
  expect(calls.filter((c) => c.path === "/api/tts")).toHaveLength(0);
  await page.getByRole("button", { name: "按句自動分段" }).first().click();
  await expect(page.getByRole("button", { name: /^進入朗讀/ })).toBeEnabled();
  await expect(page.getByLabel("口白文字", { exact: true })).toHaveCount(3);
  await page.locator("#main").getByRole("button", { name: "復原", exact: true }).click();
  await expect(original).toHaveValue(long);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await page.getByRole("button", { name: /^進入朗讀/ }).click();
  await page.getByRole("link", { name: "上一頁", exact: true }).click();
  await page.locator("#main").getByRole("button", { name: "復原", exact: true }).click();
  await expect(original).toHaveValue(long);
  await page.locator("#main").getByRole("button", { name: "復原", exact: true }).click();
  await expect(original).toHaveValue("故事開始。");
  await original.fill("新版本");
  await expect(page.getByRole("button", { name: "重做", exact: true })).toBeDisabled();
});

test("spoken corrections change synthesis without changing the transcript", async ({ page }) => {
  const calls = await mockApi(page, true);
  await page.goto("/");
  await recognize(page);
  await moreEditing(page);
  await page.getByRole("button", { name: "另設朗讀文字" }).click();
  const spoken = page.getByLabel("朗讀文字（只影響語音）");
  await expect(spoken).toHaveValue("故事開始。");
  await spoken.fill("");
  await expect(spoken).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("button", { name: /需處理 →$/ })).toBeEnabled();
  await spoken.fill("故事，開始。");
  await page.getByRole("button", { name: "產生試聽" }).first().click();
  await expect(page.getByLabel("段落試聽").getByRole("slider")).toBeEnabled();
  expect(calls.find((c) => c.path === "/api/tts")?.body).toMatchObject({ text: "故事，開始。" });
  await expect(page.getByLabel("口白文字", { exact: true }).first()).toHaveValue("故事開始。");

  await page.getByRole("button", { name: /^進入朗讀/ }).click();
  await expect(page.locator(".playback-script")).toContainText("故事開始。");
  await expect(page.locator(".playback-correction")).not.toHaveAttribute("open");
  await page.getByText("此段使用發音修正").click();
  await expect(page.locator(".playback-script")).toContainText("朗讀文字：故事，開始。");
  await page.getByRole("button", { name: "播放此段" }).click();
  await expect(page.getByRole("button", { name: "播放下一段", exact: true })).toBeVisible();
  // The preview already cached the corrected audio, so playback must reuse it.
  expect(calls.filter((c) => c.path === "/api/tts-stream")).toHaveLength(0);

  await page.getByRole("link", { name: "上一頁", exact: true }).click();
  await moreEditing(page);
  await page.getByRole("button", { name: "改回朗讀口白文字" }).click();
  await expect(page.getByLabel("朗讀文字（只影響語音）")).toHaveCount(0);
  await page.getByRole("button", { name: /^進入朗讀/ }).click();
  await page.getByRole("button", { name: "播放此段" }).click();
  await expect(page.getByRole("button", { name: "播放下一段", exact: true })).toBeVisible();
  expect(calls.find((c) => c.path === "/api/tts-stream")?.body).toMatchObject({
    text: "故事開始。",
  });
});

test("drafts export text only and import without an image or provider call", async ({ page }) => {
  const calls = await mockApi(page, true);
  await page.goto("/");
  await recognize(page);
  await moreEditing(page);
  await page.getByLabel("朗讀語氣").fill("低沉");
  await moreEditing(page, 1);
  await page.getByRole("button", { name: "另設朗讀文字" }).click();
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

  // The text is exported, but the picture and history will still be discarded.
  await clearContent(page, "proceed");
  await expect(page.getByRole("heading", { name: "校對辨識草稿" })).toHaveCount(0);
  await page.getByLabel("匯入草稿").setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...exported, version: 2 })),
  });
  await expect(page.getByRole("alert")).toContainText("不支援這個版本");
  await expect(page.getByRole("alert")).toHaveCount(1);

  const before = calls.length;
  await page.getByLabel("匯入草稿").setInputFiles({
    name: "draft.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await expect(toast(page)).toContainText("已匯入草稿 · 2 個段落");
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByLabel("口白文字", { exact: true }).nth(1)).toHaveValue("門打開了。");
  await moreEditing(page, 1);
  await expect(page.getByLabel("朗讀文字（只影響語音）")).toHaveValue("門，打開了。");
  await moreEditing(page);
  await expect(page.getByLabel("朗讀語氣")).toHaveValue("低沉");
  await expect(page.getByText("查看圖片對照")).toHaveCount(0);
  await expect(
    page.locator("#main").getByRole("button", { name: "復原", exact: true }),
  ).toBeDisabled();
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
  await page.getByRole("button", { name: /^進入朗讀/ }).click();
  await page.getByRole("button", { name: "播放此段" }).click();
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
  // The preference can be set anywhere, but only the playback screen holds the lock.
  let settings = await openSettings(page);
  const toggle = settings.getByRole("switch", { name: "朗讀時保持螢幕常亮" });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await closeSettings(page);
  expect(await wakeLog()).toEqual([]);

  await page.getByRole("button", { name: /^進入朗讀/ }).click();
  await expect.poll(wakeLog).toEqual(["request:screen"]);
  // Opening and closing settings on the playback screen keeps the lock.
  settings = await openSettings(page);
  await closeSettings(page);
  expect(await wakeLog()).toEqual(["request:screen"]);
  await page.goBack();
  await expect(page).toHaveURL(/\/review$/);
  await expect.poll(wakeLog).toEqual(["request:screen", "release"]);

  await page.goForward();
  await expect(page).toHaveURL(/\/play$/);
  await expect.poll(wakeLog).toEqual(["request:screen", "release", "request:screen"]);
  settings = await openSettings(page);
  await settings.getByRole("switch", { name: "朗讀時保持螢幕常亮" }).uncheck();
  await expect.poll(wakeLog).toEqual(["request:screen", "release", "request:screen", "release"]);
});

test("non-1× speeds skip streaming and keep the original pitch", async ({ page }) => {
  const calls = await mockApi(page, true);
  await page.goto("/");
  await recognize(page);
  await page.getByRole("button", { name: /^進入朗讀/ }).click();
  const settings = await openSettings(page);
  await expect(settings.getByText("非 1 倍速會先產生整段音訊再播放")).toHaveCount(0);
  await settings.getByRole("radio", { name: "0.75 倍" }).check();
  await expect(settings.getByText("非 1 倍速會先產生整段音訊再播放")).toBeVisible();
  await closeSettings(page);
  await page.getByRole("button", { name: "播放此段" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { bragiAudio: HTMLAudioElement }).bragiAudio.playbackRate,
      ),
    )
    .toBe(0.75);
  expect(
    await page.evaluate(
      () => (window as unknown as { bragiAudio: HTMLAudioElement }).bragiAudio.preservesPitch,
    ),
  ).toBe(true);
  expect(calls.filter((call) => call.path === "/api/tts-stream")).toHaveLength(0);
  expect(calls.filter((call) => call.path === "/api/tts").length).toBeGreaterThan(0);
});

test("voice picker labels voices, samples them and remembers the choice", async ({ page }) => {
  const calls = await mockApi(page, true);
  await page.goto("/");
  const settings = await openSettings(page);
  const opener = settings.getByRole("button", { name: /^朗讀聲音 / });
  await expect(opener).toHaveAccessibleName("朗讀聲音 預設聲音（Kore · 堅定） 更換");
  const picker = await openVoicePicker(page);
  await expect(picker.getByRole("radio")).toHaveCount(2);
  await expect(picker.getByRole("radio").nth(0)).toHaveAccessibleName("Kore · 堅定 · 預設");
  await expect(picker.getByRole("radio").nth(1)).toHaveAccessibleName("Puck · 輕快");
  await picker.getByRole("button", { name: "完成", exact: true }).click();

  await page.getByRole("button", { name: "試聽這個聲音" }).click();
  await expect(page.getByLabel("聲音試聽", { exact: true }).getByRole("slider")).toBeEnabled();
  expect(calls.filter((c) => c.path === "/api/tts").at(-1)?.body).toMatchObject({
    voice: "Kore",
    text: "夜色降臨，古老的城門在眾人面前緩緩開啟。",
  });

  await chooseVoice(page, "Puck");
  await expect(page.getByLabel("聲音試聽")).toHaveCount(0);
  await page.getByRole("button", { name: "試聽這個聲音" }).click();
  await expect(page.getByLabel("聲音試聽", { exact: true }).getByRole("slider")).toBeEnabled();
  expect(calls.filter((c) => c.path === "/api/tts").at(-1)?.body).toMatchObject({ voice: "Puck" });

  // Returning to a voice that was already sampled reuses its audio.
  await chooseVoice(page, "Kore");
  await page.getByRole("button", { name: "試聽這個聲音" }).click();
  expect(calls.filter((c) => c.path === "/api/tts")).toHaveLength(2);

  await chooseVoice(page, "Puck");
  await page.reload();
  await openSettings(page);
  await expect(opener).toHaveAccessibleName("朗讀聲音 Puck · 輕快 更換");
});

test("reading presets preserve the normal editor size and secondary spoken hierarchy", async ({
  page,
}) => {
  await mockApi(page, true);
  await page.goto("/");
  await recognize(page);
  await moreEditing(page);
  await page.getByRole("button", { name: "另設朗讀文字" }).click();
  const editorSizes: number[] = [];
  const presets = { normal: "標準", large: "大", largest: "特大" } as const;
  const choose = async (preset: keyof typeof presets) => {
    const settings = await openSettings(page);
    await settings.getByRole("radio", { name: presets[preset], exact: true }).check();
    await closeSettings(page);
  };
  for (const preset of ["normal", "large", "largest"] as const) {
    await choose(preset);
    const size = await page
      .getByLabel("口白文字", { exact: true })
      .first()
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    editorSizes.push(size);
    expect(
      await page
        .getByLabel("朗讀文字（只影響語音）")
        .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
    ).toBe(size);
  }
  // Release 1.0.0 used font: inherit, with the page's default 16px font.
  expect(editorSizes[0]).toBe(16);
  expect(editorSizes[1]).toBeGreaterThan(editorSizes[0] ?? 0);
  expect(editorSizes[2]).toBeGreaterThan(editorSizes[1] ?? 0);
  await page.getByRole("button", { name: /^進入朗讀/ }).click();
  const scriptSizes: number[] = [];
  const spokenSizes: number[] = [];
  for (const preset of ["normal", "large", "largest"] as const) {
    await choose(preset);
    const script = await page
      .locator(".playback-script p")
      .first()
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    await page.locator(".playback-correction summary").click();
    const spoken = await page
      .locator(".playback-correction p")
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    scriptSizes.push(script);
    spokenSizes.push(spoken);
    expect(spoken).toBeLessThan(script);
    expect(spoken).toBe(14);
    await page.locator(".playback-correction summary").click();
  }
  expect(spokenSizes).toEqual([14, 14, 14]);
  for (const sizes of [scriptSizes]) {
    expect(sizes[1]).toBeGreaterThan(sizes[0] ?? 0);
    expect(sizes[2]).toBeGreaterThan(sizes[1] ?? 0);
  }
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
  await page.getByLabel("匯入草稿").setInputFiles({
    name: "50.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(draft)),
  });
  await expect(page.getByLabel("口白文字", { exact: true })).toHaveCount(50);
  await moreEditing(page);
  for (const name of ["新增段落", "從游標分割", "在下方新增", "按句自動分段"])
    await expect(page.getByRole("button", { name, exact: true }).first()).toBeDisabled();
  await expect(page.locator("#draft-limit-note")).toContainText("50 個段落");
  await page.getByLabel("口白文字", { exact: true }).first().fill("😀".repeat(10_001));
  await expect(page.getByRole("alert")).toContainText("欄位限制");
  await expect(page.getByLabel("口白文字", { exact: true }).first()).toHaveValue("故事開始。");
  await moreEditing(page, 49);
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
  await openComparison(page);
  const imageBytes = () =>
    page
      .getByAltText("校對用圖片")
      .evaluate(async (img: HTMLImageElement) =>
        Array.from(new Uint8Array(await (await fetch(img.src)).arrayBuffer())),
      );
  const oldImage = await imageBytes();
  await closeComparison(page);
  await goToStep(page, "取圖");
  await page.getByLabel("題材提示（選填）").fill("舊題材");
  await page
    .getByLabel("選擇圖片")
    .setInputFiles({ name: "candidate.png", mimeType: "image/png", buffer: image });
  await expect(page.getByAltText("準備上傳的圖片預覽")).toBeVisible();
  await page.getByLabel("題材提示（選填）").fill("候選題材");
  // The draft and its history are untouched while the candidate waits.
  await goToStep(page, "校對");
  await expect(page.getByLabel("口白文字", { exact: true })).toHaveCount(2);
  await expect(page.getByLabel("口白文字", { exact: true }).first()).toHaveValue("保留這段修改。");
  await expect(
    page.locator("#main").getByRole("button", { name: "復原", exact: true }),
  ).toBeEnabled();
  await openComparison(page);
  expect(await imageBytes()).toEqual(oldImage);
  await closeComparison(page);
  await goToStep(page, "取圖");
  // Coming back shows the candidate again.
  await expect(page.getByAltText("準備上傳的圖片預覽")).toBeVisible();
  await page.getByRole("button", { name: "取消候選圖片" }).click();
  await expect(page.getByLabel("題材提示（選填）")).toHaveValue("舊題材");

  await page
    .getByLabel("選擇圖片")
    .setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: Buffer.from("broken") });
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "重試圖片處理" })).toBeVisible();
  await expect(page.locator(".capture-preview .file")).toContainText("broken.png");
  await page.getByRole("button", { name: "重試圖片處理" }).click();
  await expect(page.getByRole("alert")).toBeVisible();

  await page
    .getByLabel("選擇圖片")
    .setInputFiles({ name: "candidate.png", mimeType: "image/png", buffer: image });
  await page.route("**/api/ocr", (route) =>
    route.fulfill({ status: 502, json: { error: "辨識暫時失敗" } }),
  );
  await page.getByRole("button", { name: /^(辨識文字|重新辨識)$/ }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByAltText("準備上傳的圖片預覽")).toBeVisible();

  await page.route("**/api/ocr", (route) =>
    route.fulfill({
      json: {
        detectedLanguage: "English",
        segments: [{ id: "new", text: "A new story.", suggestedToneHint: "" }],
      },
    }),
  );
  await page.getByRole("button", { name: /^(辨識文字|重新辨識)$/ }).click();
  await page
    .getByRole("dialog", { name: "取代目前稿件？" })
    .getByRole("button", { name: "取消", exact: true })
    .last()
    .click();
  await expect(page.getByText("已保留目前稿件；候選圖片可重新辨識")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await goToStep(page, "校對");
  await expect(page.getByLabel("口白文字", { exact: true }).first()).toHaveValue("保留這段修改。");
  await expect(
    page.locator("#main").getByRole("button", { name: "復原", exact: true }),
  ).toBeEnabled();
  await goToStep(page, "取圖");
  await page.getByRole("button", { name: /^(辨識文字|重新辨識)$/ }).click();
  await page
    .getByRole("dialog", { name: "取代目前稿件？" })
    .getByRole("button", { name: "不匯出，直接取代", exact: true })
    .last()
    .click();
  await expect(page).toHaveURL(/\/review$/);
  await expect(toast(page)).toContainText("辨識完成 · 1 個段落");
  await expect(page.getByLabel("口白文字", { exact: true })).toHaveCount(1);
  await expect(page.getByLabel("口白文字", { exact: true })).toHaveValue("A new story.");
  await expect(page.getByText("主要語言：English · 1 個段落")).toBeVisible();
  await expect(
    page.locator("#main").getByRole("button", { name: "復原", exact: true }),
  ).toBeDisabled();
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
      .getByLabel("選擇圖片")
      .setInputFiles({ name: "card.png", mimeType: "image/png", buffer: image });
    await page.getByRole("button", { name: /^(辨識文字|重新辨識)$/ }).click();
    await expect(page.getByText("辨識與分段…")).toBeVisible();
    await clearContent(page, "proceed");
    await page.evaluate(
      (fail) => (window as unknown as { finishOcr: (fail: boolean) => void }).finishOcr(fail),
      fail,
    );
    await expect(toast(page)).toContainText("已清除目前內容，登入狀態已保留");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByLabel("口白文字", { exact: true })).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);
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
  await goToStep(page, "取圖");
  await page
    .getByLabel("匯入草稿")
    .setInputFiles({ name: "late.json", mimeType: "application/json", buffer: Buffer.from("{}") });
  await expect
    .poll(() =>
      page.evaluate(() => typeof (window as unknown as { finishImport: unknown }).finishImport),
    )
    .toBe("function");
  await page
    .getByLabel("選擇圖片")
    .setInputFiles({ name: "new.png", mimeType: "image/png", buffer: image });
  await expect(page.getByAltText("準備上傳的圖片預覽")).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { finishImport: (source: string) => void }).finishImport("{"),
  );
  await expect(page.getByText("圖片已準備完成，可以開始辨識")).toBeVisible();
  await page
    .getByLabel("匯入草稿")
    .setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from("{") });
  await expect(page.getByRole("alert")).toContainText("JSON");
  await goToStep(page, "校對");
  await expect(page.getByLabel("口白文字", { exact: true })).toHaveCount(2);
  await expect(page.getByLabel("口白文字", { exact: true }).first()).toHaveValue("保留舊稿。");
  await expect(
    page.locator("#main").getByRole("button", { name: "復原", exact: true }),
  ).toBeEnabled();
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
  await goToStep(page, "取圖");
  await page
    .getByLabel("選擇圖片")
    .setInputFiles({ name: "slow.png", mimeType: "image/png", buffer: image });
  await expect(page.getByText("正在調整方向與圖片大小…")).toBeVisible();
  await clearContent(page, "proceed");
  await page.evaluate(() =>
    (window as unknown as { failImage: (error: Error) => void }).failImage(
      new Error("late image error"),
    ),
  );
  await expect(toast(page)).toContainText("已清除目前內容，登入狀態已保留");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(辨識文字|重新辨識)$/ })).toHaveCount(0);

  await page
    .getByLabel("匯入草稿")
    .setInputFiles({ name: "slow.json", mimeType: "application/json", buffer: Buffer.from("{}") });
  await expect
    .poll(() =>
      page.evaluate(() => typeof (window as unknown as { finishImport: unknown }).finishImport),
    )
    .toBe("function");
  await clearContent(page);
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
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => localStorage.getItem("bragi:autosave:v1"))).toBeNull();
});

test("autosave restores only text after reload, and clear or logout removes it", async ({
  page,
}) => {
  const calls = await mockApi(page, true);
  await page.goto("/");
  await recognize(page);
  await page.getByLabel("口白文字", { exact: true }).first().fill("重新整理後仍保留。");
  await moreEditing(page);
  await page.getByRole("button", { name: "另設朗讀文字" }).click();
  await page.getByLabel("朗讀文字（只影響語音）").fill("重新整理，仍保留。");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("bragi:autosave:v1") ?? "{}").segments?.[0]?.spokenText,
      ),
    )
    .toBe("重新整理，仍保留。");
  // A reload empties the in-memory draft, so review sends the person to capture to recover it.
  await page.reload();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "恢復上次的草稿" })).toBeVisible();
  await expect(page.getByLabel("口白文字", { exact: true })).toHaveCount(0);
  const before = calls.filter((call) => call.path !== "/api/session").length;
  await page.getByRole("button", { name: "恢復上次的草稿" }).click();
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByLabel("口白文字", { exact: true }).first()).toHaveValue(
    "重新整理後仍保留。",
  );
  await moreEditing(page);
  await expect(page.getByLabel("朗讀文字（只影響語音）")).toHaveValue("重新整理，仍保留。");
  await expect(page.getByText("查看圖片對照")).toHaveCount(0);
  expect(calls.filter((call) => call.path !== "/api/session")).toHaveLength(before);
  // A recovered draft has no exported copy, so clearing asks first.
  await clearContent(page, "proceed");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("bragi:autosave:v1")))
    .toBeNull();
  await page.reload();
  await expect(page.getByRole("button", { name: "恢復上次的草稿" })).toHaveCount(0);
  await recognize(page);
  await signOut(page, "proceed");
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
  await expect(page.getByRole("heading", { name: "準備下一段故事" })).toBeVisible();
  await expect(page.getByRole("button", { name: "恢復上次的草稿" })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("bragi:autosave:v1"))).toBeNull();
});

test("draft recovery stays private until session checking and sign-in complete", async ({
  page,
}) => {
  const calls = await mockApi(page);
  await page.addInitScript(() =>
    localStorage.setItem(
      "bragi:autosave:v1",
      JSON.stringify({
        format: "bragi-draft",
        version: 1,
        exportedAt: new Date().toISOString(),
        detectedLanguage: "zh",
        segments: [{ id: "saved", text: "登入後才能恢復。", suggestedToneHint: "" }],
      }),
    ),
  );
  let finishSession!: () => void;
  const checking = new Promise<void>((resolve) => {
    finishSession = resolve;
  });
  await page.route("**/api/session", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await checking;
    return route.fulfill({ json: { authenticated: false } });
  });
  // A deep link waits for sign-in too.
  await page.goto("/review");
  await expect(page.getByText("正在確認登入狀態…")).toBeVisible();
  await expect(page.getByRole("region", { name: "本機暫存草稿" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "恢復上次的草稿" })).toHaveCount(0);
  finishSession();
  await expect(page.getByRole("button", { name: "登入", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "本機暫存草稿" })).toHaveCount(0);
  await signIn(page);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "恢復上次的草稿" })).toBeVisible();
  await page.getByRole("button", { name: "恢復上次的草稿" }).click();
  await expect(page.getByLabel("口白文字", { exact: true })).toHaveValue("登入後才能恢復。");
  expect(calls.filter((call) => call.path !== "/api/session")).toHaveLength(0);
  await signOut(page, "proceed");
  expect(await page.evaluate(() => localStorage.getItem("bragi:autosave:v1"))).toBeNull();
});

for (const mode of ["playback", "stream"] as const) {
  test(`${mode} audio keeps playing while a background recognition fails or is declined, until replacement`, async ({
    page,
  }) => {
    await mockApi(page, true);
    await page.route("**/api/tts", (route) =>
      route.fulfill({
        contentType: "audio/wav",
        body: Buffer.from(pcmToWav(Buffer.alloc(24_000 * 2 * 60))),
      }),
    );
    if (mode === "stream") {
      await page.addInitScript(() => {
        const Original = window.AudioContext;
        window.AudioContext = class extends Original {
          constructor(options?: AudioContextOptions) {
            super(options);
            Object.assign(window, { originalStream: this, originalAudio: undefined });
          }
        };
      });
      await page.route("**/api/tts-stream", (route) =>
        route.fulfill({
          contentType: "audio/l16",
          headers: { "x-audio-sample-rate": "24000" },
          body: Buffer.alloc(24_000 * 2 * 60),
        }),
      );
    }
    await page.goto("/");
    await recognize(page);
    let finishOcr!: () => void;
    let ocrPending = false;
    let failure = true;
    await page.route("**/api/ocr", async (route) => {
      await new Promise<void>((resolve) => {
        finishOcr = resolve;
        ocrPending = true;
      });
      if (failure) return route.fulfill({ status: 502, json: { error: "OCR failed" } });
      return route.fulfill({
        json: {
          detectedLanguage: "en",
          segments: [{ id: "replacement", text: "Replacement.", suggestedToneHint: "" }],
        },
      });
    });
    // Start a recognition on capture, then go and read the current draft while it runs.
    const startOcrAndPlay = async () => {
      ocrPending = false;
      await goToStep(page, "取圖");
      await page
        .getByLabel("選擇圖片")
        .setInputFiles({ name: "new.png", mimeType: "image/png", buffer: image });
      await page.getByRole("button", { name: /^(辨識文字|重新辨識)$/ }).click();
      await expect.poll(() => ocrPending).toBe(true);
      await goToStep(page, "朗讀");
      await page.getByRole("button", { name: "播放此段", exact: true }).click();
      await expect(page.getByRole("button", { name: "暫停", exact: true })).toBeVisible();
      await page.evaluate(() => {
        const host = window as unknown as {
          bragiAudio: HTMLAudioElement;
          originalAudio?: HTMLAudioElement;
          originalStream?: AudioContext;
        };
        host.originalAudio = host.bragiAudio;
        // At EOF the native element holds metadata while PCM still plays. A running PCM
        // context remains the source; a later cache hit uses the retained native element.
        if (!host.bragiAudio.paused) host.originalStream = undefined;
      });
    };
    const paused = () =>
      mode === "stream"
        ? page.evaluate(() =>
            (
              window as unknown as {
                originalStream?: AudioContext;
                originalAudio?: HTMLAudioElement;
              }
            ).originalStream
              ? (window as unknown as { originalStream: AudioContext }).originalStream.state !==
                "running"
              : (window as unknown as { originalAudio: HTMLAudioElement }).originalAudio.paused,
          )
        : page.evaluate(
            () => (window as unknown as { originalAudio: HTMLAudioElement }).originalAudio.paused,
          );
    if (mode === "playback") {
      const settings = await openSettings(page);
      await settings.getByRole("radio", { name: "1.25 倍" }).check();
      await closeSettings(page);
    }
    await startOcrAndPlay();
    await expect.poll(paused).toBe(false);
    const response = page.waitForResponse("**/api/ocr");
    finishOcr();
    await response;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(await paused()).toBe(false);

    failure = false;
    await page.getByRole("link", { name: "上一頁", exact: true }).click();
    await startOcrAndPlay();
    await expect.poll(paused).toBe(false);
    finishOcr();
    await page
      .getByRole("dialog", { name: "取代目前稿件？" })
      .getByRole("button", { name: "取消", exact: true })
      .last()
      .click();
    await expect(page.getByRole("button", { name: "暫停", exact: true })).toBeVisible();
    expect(await paused()).toBe(false);

    await page.getByRole("link", { name: "上一頁", exact: true }).click();
    await startOcrAndPlay();
    finishOcr();
    await page
      .getByRole("dialog", { name: "取代目前稿件？" })
      .getByRole("button", { name: "不匯出，直接取代", exact: true })
      .click();
    await expect(page).toHaveURL(/\/review$/);
    await expect(page.getByLabel("口白文字", { exact: true })).toHaveValue("Replacement.");
    await expect.poll(paused).toBe(true);
  });
}
