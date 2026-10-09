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

/** A signed-in API with deterministic responses; nothing reaches a real provider. */
export async function mockSignedInApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    switch (path) {
      case "/api/session":
        return route.fulfill({ json: { authenticated: true, voices: ["Kore", "Puck"] } });
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
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173(?:\/|$))/, (route) => route.abort());
}

export async function selectImage(page: Page) {
  await page
    .getByLabel("從相簿選擇")
    .setInputFiles({ name: "card.png", mimeType: "image/png", buffer: image });
  await expect(page.getByRole("button", { name: "上傳並辨識文字", exact: true })).toBeEnabled();
}

export async function recognize(page: Page) {
  await selectImage(page);
  await page.getByRole("button", { name: "上傳並辨識文字", exact: true }).click();
  await expect(page.getByRole("heading", { name: "3. 校對辨識草稿" })).toBeFocused();
}
