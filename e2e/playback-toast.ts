import { expect, type Page } from "@playwright/test";
import { chooseVoice, closeSettings, openSettings } from "./fixtures";

type Rect = { x: number; y: number; width: number; height: number };

/** The controls under the reading toast, in page coordinates; no message may move any of them. */
export function controls(page: Page) {
  return page.locator(".playback-transport").evaluate((transport) =>
    [
      transport,
      ...transport.querySelectorAll(
        ".playback-meter, .playback-seek, .playback-primary, .playback-secondary",
      ),
    ].map((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y: y + window.scrollY, width, height };
    }),
  );
}

/** Where the reading toast is, how many lines its message takes, and whether the page overflows. */
async function place(page: Page) {
  return page.locator(".playback-toast").evaluate(async (toast) => {
    // Measure where the toast rests, not a frame of its slide-in.
    await Promise.all(toast.getAnimations().map((animation) => animation.finished));
    const box = toast.getBoundingClientRect();
    const { x, width, height } = box;
    const y = box.y + window.scrollY;
    const message = toast.querySelector("p") as HTMLElement;
    return {
      rect: { x, y, width, height },
      lines: Math.round(
        message.getBoundingClientRect().height /
          Number.parseFloat(getComputedStyle(message).lineHeight),
      ),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
}

/**
 * Plays through every reading message (shared toast, speed note, preparing, error, blocked,
 * interrupted, settings note, completion) and checks that each floats in the same place above the clock row,
 * over nothing but the script or segment list, without moving a control. Starts on an idle
 * `/play` at 1×, right after recognition, with the shared "recognition done" toast showing.
 */
export async function expectOneMessagePlace(page: Page) {
  const toast = page.locator(".playback-toast");
  const primary = page.locator(".playback-primary");
  const phase = (value: string) =>
    expect(page.locator(".playback")).toHaveAttribute("data-phase", value);
  await expect(page.locator(".playback-status-slot")).toHaveCount(0);
  const initial = await controls(page);
  const places: { label: string; rect: Rect }[] = [];
  async function record(label: string, text: string | RegExp) {
    await expect(toast).toContainText(text);
    await expect(toast).not.toHaveClass(/toast-empty/);
    const value = await place(page);
    expect(value.lines, label).toBeLessThanOrEqual(3);
    expect(value.overflow, label).toBeLessThanOrEqual(0);
    places.push({ label, rect: value.rect });
    expect(await controls(page), label).toEqual(initial);
  }

  await record("shared toast", "辨識完成");
  // At 1.5x every take is a full WAV through the media element, so the fixture can also refuse it.
  // (Retrying after a failed PCM stream can hang Linux WebKit; that happens before this change too.)
  const sheet = await openSettings(page);
  await sheet.getByRole("radio", { name: "1.5 倍" }).check();
  await closeSettings(page);
  await record("rate note", "非 1 倍速會先產生整段音訊再播放");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/tts", async (route) => {
    await held;
    await route.fulfill({
      status: 503,
      json: { error: { code: "TTS_UNAVAILABLE", message: "x", requestId: "tts-toast" } },
    });
  });
  await primary.click();
  await phase("loading");
  await record("preparing", "正在準備音訊");
  release();
  await phase("error");
  await record("error", "語音服務暫時無法使用");
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(toast.getByRole("alert")).toContainText("技術詳情");
  await page.unroute("**/api/tts");
  await primary.click();
  await phase("playing");
  // The state it described is over.
  await expect(toast).toHaveClass(/toast-empty/);
  expect(await controls(page)).toEqual(initial);
  await primary.click();
  await phase("paused");
  await page.evaluate(() => {
    window.audioTest.rejectNext = true;
  });
  await primary.click();
  await phase("blocked");
  await record("blocked", "瀏覽器阻止播放");
  await primary.click();
  await phase("playing");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await phase("interrupted");
  await record("interrupted", "鎖屏");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await primary.click();
  await phase("playing");
  await primary.click();
  await phase("paused");
  await openSettings(page);
  await chooseVoice(page, "Puck");
  await closeSettings(page);
  await record("next settings", /下一次播放套用：.*Puck/);
  await primary.click();
  await phase("playing");
  await page.evaluate(() => window.audioTest.finish());
  await phase("waiting");
  await primary.click();
  await phase("playing");
  await page.evaluate(() => window.audioTest.finish());
  await phase("complete");
  await record("complete", "全部段落播放完成");

  const [transport] = initial;
  if (!transport) throw new Error("No transport");
  const [first] = places;
  if (!first) throw new Error("No message");
  for (const { label, rect } of places) {
    // One place: the same column, the same bottom edge; only the height follows the text.
    expect(Math.abs(rect.x - first.rect.x), label).toBeLessThanOrEqual(2);
    expect(Math.abs(rect.width - first.rect.width), label).toBeLessThanOrEqual(2);
    expect(
      Math.abs(rect.y + rect.height - first.rect.y - first.rect.height),
      label,
    ).toBeLessThanOrEqual(2);
    // Just above the clock row, inside the content column, clear of the slider and buttons.
    expect(rect.y + rect.height, label).toBeLessThanOrEqual(transport.y);
    expect(transport.y - rect.y - rect.height, label).toBeLessThanOrEqual(12);
    expect(rect.x, label).toBeGreaterThanOrEqual(transport.x - 1);
    expect(rect.x + rect.width, label).toBeLessThanOrEqual(transport.x + transport.width + 1);
  }
  return places;
}
