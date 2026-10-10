import { expect, type Page } from "@playwright/test";
import { pcmToWav } from "../src/lib/wav";

export const pcm = Buffer.alloc(12_000);
export const wav = Buffer.from(pcmToWav(pcm));
export const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC",
  "base64",
);

export const segments = [
  {
    id: "one",
    text: "雨夜裡，阿卡姆的街燈一盞接一盞熄滅。你們推開圖書館的側門，霉味與舊紙的氣息撲面而來。",
    suggestedToneHint: "低沉、緩慢",
  },
  {
    id: "two",
    text: "館員不在櫃檯。桌上攤著一本翻到一半的日記，墨跡還沒乾。",
    suggestedToneHint: "疑惑、壓低聲音",
  },
];

/**
 * Touch targets are measured in CSS pixels, but layout snaps edges to device pixels, so a 44px
 * control at a fractional offset on a 2.625× screen can measure 43.99997px.
 */
export function expectTouchSize(size: number, minimum: number, label?: string) {
  expect(size, label).toBeGreaterThanOrEqual(minimum - 0.01);
}

/**
 * Hides the pre-generated voice samples, so previews go through the live speech fallback that
 * tests mock and count. Tests of the files themselves route them after this.
 */
export async function withoutVoiceSampleFiles(page: Page) {
  await page.route("**/voice-samples/**", (route) => route.fulfill({ status: 404 }));
}

/** A deterministic API, signed in unless asked otherwise; nothing reaches a real provider. */
export async function mockSignedInApi(page: Page, { authenticated = true } = {}) {
  await observeAudio(page);
  await withoutVoiceSampleFiles(page);
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    switch (path) {
      case "/api/session":
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
        return route.fulfill({ json: { file: { name: "files/test" } } });
      case "/api/ocr":
        return route.fulfill({ json: { detectedLanguage: "繁體中文", segments } });
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
  await page.route(/^https?:\/\/(?!127\.0\.0\.1(?::\d+)?(?:\/|$))/, (route) => route.abort());
}

export async function selectImage(page: Page) {
  await page
    .getByLabel("選擇圖片")
    .setInputFiles({ name: "card.png", mimeType: "image/png", buffer: image });
  await expect(page.getByRole("button", { name: /^(辨識文字|重新辨識)$/ })).toBeEnabled();
}

export async function recognize(page: Page) {
  await selectImage(page);
  await page.getByRole("button", { name: /^(辨識文字|重新辨識)$/ }).click();
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByRole("heading", { name: "校對辨識草稿" })).toBeFocused();
}

export const settingsButton = (page: Page) =>
  page.getByRole("button", { name: "設定", exact: true });

export const settingsSheet = (page: Page) => page.getByRole("dialog", { name: "設定" });

export async function openSettings(page: Page) {
  await settingsButton(page).click();
  await expect(settingsSheet(page)).toBeVisible();
  return settingsSheet(page);
}

export async function closeSettings(page: Page) {
  await settingsSheet(page).getByRole("button", { name: "關閉設定" }).click();
  await expect(settingsSheet(page)).toBeHidden();
}

/** Clears from settings; `confirm` answers the export-first question when it is asked. */
export async function clearContent(page: Page, confirm: "proceed" | "none" = "none") {
  const sheet = await openSettings(page);
  await sheet.getByRole("button", { name: "清除目前內容" }).click();
  if (confirm === "proceed")
    await page
      .getByRole("dialog", { name: "清除目前內容？" })
      .getByRole("button", { name: "不匯出，直接清除" })
      .click();
  await expect(settingsSheet(page)).toBeHidden();
}

export async function signOut(page: Page, confirm: "proceed" | "none" = "none") {
  const sheet = await openSettings(page);
  await sheet.getByRole("button", { name: "登出", exact: true }).click();
  if (confirm === "proceed")
    await page
      .getByRole("dialog", { name: "登出？" })
      .getByRole("button", { name: "不匯出，直接登出" })
      .click();
  await expect(page.getByLabel("驗證碼")).toBeVisible();
}

/** Types a code; six digits send it on their own. */
export async function signIn(page: Page, code = "123456") {
  await page.getByLabel("驗證碼").fill(code);
  await page.getByRole("button", { name: "開始使用" }).click();
}

export const steps = (page: Page) => page.getByRole("navigation", { name: "步驟" });

export async function goToStep(page: Page, name: "取圖" | "校對" | "朗讀") {
  await steps(page).getByRole("link", { name, exact: true }).click();
}

export const toast = (page: Page) => page.locator(".toast");

export function draftFile(text: string, name = "draft.json") {
  return {
    name,
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format: "bragi-draft",
        version: 1,
        exportedAt: "2026-10-09T00:00:00Z",
        detectedLanguage: "繁體中文",
        segments: [{ id: "imported", text, suggestedToneHint: "" }],
      }),
    ),
  };
}

/** Observe the app's one off-DOM native element without creating another sound source. */
export async function observeAudio(page: Page) {
  await page.addInitScript(() => {
    const Original = window.Audio;
    window.Audio = class extends Original {
      constructor(src?: string) {
        super(src);
        Object.assign(window, { bragiAudio: this });
      }
    };
  });
}

/** Open only the requested paragraph's progressive editing tools. */
export async function moreEditing(page: Page, index = 0) {
  const card = page.locator(".review-segment").nth(index);
  const opener = card.getByRole("button", { name: "更多編輯", exact: true });
  if (await opener.count()) await opener.click();
  await expect(card.locator(".segment-more")).toBeVisible();
  return card;
}

export async function closeComparison(page: Page) {
  const sheet = page.getByRole("dialog", { name: "查看圖片對照", exact: true });
  if (await sheet.isVisible()) await sheet.getByRole("button", { name: "關閉原圖對照" }).click();
}

export async function openComparison(page: Page) {
  const opener = page.getByRole("button", { name: "查看圖片對照", exact: true });
  if (await opener.isVisible()) await opener.click();
  else if ((await page.locator(".image-comparison").getAttribute("open")) === null)
    await page.locator(".image-comparison summary").click();
  await expect(page.getByAltText("校對用圖片")).toBeVisible();
}

export const voicePicker = (page: Page) => page.getByRole("dialog", { name: "選擇朗讀聲音" });

/** Opens the voice picker from settings, opening settings first when needed. */
export async function openVoicePicker(page: Page) {
  if (!(await settingsSheet(page).isVisible())) await openSettings(page);
  await settingsSheet(page)
    .getByRole("button", { name: /^朗讀聲音 / })
    .click();
  await expect(voicePicker(page)).toBeVisible();
  return voicePicker(page);
}

/** Chooses a voice in the picker and returns to settings. */
export async function chooseVoice(page: Page, name: string) {
  const picker = await openVoicePicker(page);
  await picker.getByRole("radio", { name: new RegExp(`^${name} `) }).check();
  await picker.getByRole("button", { name: "完成", exact: true }).click();
  await expect(picker).toBeHidden();
}
