import { expect, type Page } from "@playwright/test";
import { chooseVoice, closeSettings, openSettings } from "./fixtures";

type Rect = { x: number; y: number; width: number; height: number };

/**
 * The controls under the reading toast, in page coordinates; no message may move any of them.
 * Measured once a pressed button has eased back, so a click just before does not read as a move.
 */
export function controls(page: Page) {
  return page.locator(".playback-transport").evaluate(async (transport) => {
    // Transitions only: a spinner's animation never finishes.
    await Promise.all(
      transport
        .getAnimations({ subtree: true })
        .filter((animation) => animation instanceof CSSTransition)
        // A transition replaced by another rejects; the newer one is still awaited.
        .map((animation) => animation.finished.catch(() => undefined)),
    );
    return [
      transport,
      ...transport.querySelectorAll(
        ".playback-meter, .playback-seek, .playback-primary, .playback-secondary",
      ),
    ].map((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y: y + window.scrollY, width, height };
    });
  });
}

/**
 * Keeps every message up until the page replaces or clears it, as a pointer resting on the toast
 * would: the walk then checks where messages go, never whether it beat a 4–8 s timer on a slow
 * runner. Holds the shell's toast too, since "recognition done" starts there before `/play`.
 * Call before the page loads.
 */
export function holdToasts(page: Page) {
  return page.addInitScript(() => {
    const held = new WeakSet<Element>();
    new MutationObserver(() => {
      for (const toast of document.querySelectorAll(".toast")) {
        if (held.has(toast)) continue;
        held.add(toast);
        const hold = () => toast.dispatchEvent(new PointerEvent("pointerenter"));
        hold();
        // The real pointer may cross the toast on its way between clicks; its leaving would let go.
        toast.addEventListener("pointerleave", hold);
      }
    }).observe(document, { childList: true, subtree: true });
  });
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
 * interrupted, settings note, completion) and checks that each floats in the same place, without
 * moving a control: above the clock row on a phone, at the foot of the script column when wide.
 * Starts on an idle `/play` at 1×, right after recognition, with the shared "recognition done"
 * toast showing and held by `holdToasts`.
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
  // The state it described is over, and the speed note it cut short comes back in its place.
  await expect(toast.getByRole("alert")).toHaveCount(0);
  await record("rate note again", "非 1 倍速會先產生整段音訊再播放");
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
  const frame = await page.evaluate(() => {
    const rect = (selector: string) => {
      const { x, y, width, height } = (
        document.querySelector(selector) as HTMLElement
      ).getBoundingClientRect();
      return { x, y: y + window.scrollY, width, height };
    };
    return {
      script: rect(".playback-script"),
      layout: rect(".playback-layout"),
      viewportBottom: window.scrollY + window.innerHeight,
    };
  });
  // Wide screens put the script beside the controls; the toast then sits at the script's foot.
  const wide = frame.script.x + frame.script.width < transport.x;
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
    const bottom = rect.y + rect.height;
    if (wide) {
      // Across the script column at its foot (or the screen's, for a long script), beside the
      // controls rather than over them.
      expect(rect.x, label).toBeGreaterThanOrEqual(frame.script.x - 1);
      expect(rect.x + rect.width, label).toBeLessThanOrEqual(
        frame.script.x + frame.script.width + 1,
      );
      expect(rect.x + rect.width, label).toBeLessThan(transport.x);
      const foot = Math.min(frame.layout.y + frame.layout.height, frame.viewportBottom - 16);
      expect(Math.abs(bottom - foot), label).toBeLessThanOrEqual(2);
    } else {
      // Just above the clock row, inside the content column, clear of the slider and buttons.
      expect(bottom, label).toBeLessThanOrEqual(transport.y);
      expect(transport.y - bottom, label).toBeLessThanOrEqual(12);
      expect(rect.x, label).toBeGreaterThanOrEqual(transport.x - 1);
      expect(rect.x + rect.width, label).toBeLessThanOrEqual(transport.x + transport.width + 1);
    }
  }
  return places;
}

/** A script well past one screen; still under the 400-character reading limit. */
export const longScript = Array.from(
  { length: 6 },
  (_, index) =>
    `第${index + 1}段：雨夜裡，阿卡姆的街燈一盞接一盞熄滅。你們推開圖書館的側門，霉味與舊紙的氣息撲面而來。館員不在櫃檯。`,
).join("");

/**
 * On a wide screen with a script taller than the screen, a message stays at the foot of what is
 * visible of the script column, beside the controls, and settles at the column's own foot once
 * the page is scrolled to its end. Starts on an idle `/play` at 1× showing `longScript`, with
 * messages held by `holdToasts` so the note stays up while the page scrolls under it.
 */
export async function expectFootOfLongScript(page: Page) {
  const toast = page.locator(".playback-toast");
  const initial = await controls(page);
  const sheet = await openSettings(page);
  await sheet.getByRole("radio", { name: "1.5 倍" }).check();
  await closeSettings(page);
  await expect(toast).toContainText("非 1 倍速會先產生整段音訊再播放");
  const measure = () =>
    page.evaluate(() => {
      const rect = (selector: string) =>
        (document.querySelector(selector) as HTMLElement).getBoundingClientRect();
      return {
        toast: rect(".playback-toast"),
        script: rect(".playback-script"),
        layout: rect(".playback-layout"),
        controls: rect(".playback-controls"),
        height: window.innerHeight,
        scroll: window.scrollY,
      };
    });
  for (const to of ["top", "end"] as const) {
    await page.evaluate(
      (end) => window.scrollTo(0, end ? document.documentElement.scrollHeight : 0),
      to === "end",
    );
    await expect.poll(() => page.evaluate(() => window.scrollY > 0)).toBe(to === "end");
    // An empty toast also rests at the foot; measure the note itself.
    await expect(toast, to).toContainText("非 1 倍速會先產生整段音訊再播放");
    const frame = await measure();
    if (to === "top") expect(frame.layout.bottom).toBeGreaterThan(frame.height);
    // Inside the script column and clear of the segment list, slider and buttons.
    expect(frame.toast.left, to).toBeGreaterThanOrEqual(frame.script.left - 1);
    expect(frame.toast.right, to).toBeLessThanOrEqual(frame.script.right + 1);
    expect(frame.toast.right, to).toBeLessThan(frame.controls.left);
    const foot = Math.min(frame.layout.bottom, frame.height - 16);
    expect(Math.abs(frame.toast.bottom - foot), to).toBeLessThanOrEqual(2);
    expect(frame.toast.top, to).toBeGreaterThanOrEqual(0);
  }
  expect(await controls(page)).toEqual(initial);
}
