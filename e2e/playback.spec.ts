import { expect, type Page, test } from "@playwright/test";
import { mockAudio } from "./audio-fixture";
import {
  closeSettings,
  goToStep,
  mockSignedInApi,
  openSettings,
  recognize,
  segments,
} from "./fixtures";

async function enter(page: Page, rate = 1) {
  await mockSignedInApi(page);
  await mockAudio(page);
  await page.route("**/api/tts-stream", (route) =>
    route.fulfill({
      contentType: "audio/l16",
      headers: { "x-audio-sample-rate": "24000" },
      body: Buffer.alloc(24_000 * 2 * 8),
    }),
  );
  if (rate !== 1)
    await page.addInitScript(
      (value) => localStorage.setItem("bragi-playback-rate", String(value)),
      rate,
    );
  await page.goto("/");
  await recognize(page);
  await page.getByRole("button", { name: /^進入朗讀/ }).click();
  await expect(page.locator(".playback")).toHaveAttribute("data-phase", "idle");
}
const primary = (page: Page) => page.locator(".playback-primary");
const phase = (page: Page, value: string) =>
  expect(page.locator(".playback")).toHaveAttribute("data-phase", value);
const finish = (page: Page) => page.evaluate(() => window.audioTest.finish());
async function calls(page: Page) {
  const requests: { path: string; body: { text: string; voice?: string } }[] = [];
  await page.route("**/api/tts*", async (route) => {
    requests.push({
      path: new URL(route.request().url()).pathname,
      body: route.request().postDataJSON(),
    });
    await route.fallback();
  });
  return requests;
}
async function bounds(page: Page) {
  return page.evaluate(() =>
    [
      ".playback-transport",
      ".playback-status-slot",
      ".playback-seek",
      ".playback-primary",
      ".playback-secondary",
    ].map((selector) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return { height: rect?.height, top: rect ? rect.top + window.scrollY : undefined };
    }),
  );
}

test("one click plays PCM, cached and preloaded WAV; every segment stops at ended", async ({
  page,
}) => {
  await enter(page);
  const requests = await calls(page);
  await primary(page).click();
  await phase(page, "playing");
  expect(requests.filter((entry) => entry.path === "/api/tts-stream")).toHaveLength(1);
  await expect(page.getByRole("button", { name: /選擇第 2 段 · 已備妥/ })).toBeVisible();
  await finish(page);
  await phase(page, "waiting");
  await expect(primary(page)).toHaveText("播放下一段");
  expect(await page.evaluate(() => window.audioTest.outputCount())).toBe(0);
  const before = requests.length;
  await page.getByRole("button", { name: "重播本段", exact: true }).click();
  await phase(page, "playing");
  expect(requests.length).toBe(before);
  expect(await page.evaluate(() => window.audioTest.audio.paused)).toBe(false);
  await finish(page);
  await phase(page, "waiting");
  await primary(page).click();
  await phase(page, "playing");
  expect(requests.length).toBe(before);
  await finish(page);
  await phase(page, "complete");
  await expect(primary(page)).toHaveText("完成朗讀");
  await expect(page.getByRole("button", { name: /選擇第 [12] 段 · 已播放/ })).toHaveCount(2);
  expect(await page.evaluate(() => window.audioTest.audio.querySelector("track")?.kind)).toBe(
    "captions",
  );
  await expect(page.locator("audio[controls]")).toHaveCount(0);
});

test("all primary states retain the control height and button positions; retry and blocked recovery", async ({
  page,
}) => {
  await enter(page, 1.5);
  await expect(primary(page)).toHaveText("播放此段");
  const initial = await bounds(page);
  const requests = await calls(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/tts", async (route) => {
    await held;
    await route.fulfill({ status: 503, json: { error: "Try again" } });
  });
  await primary(page).click();
  await phase(page, "loading");
  await expect(primary(page)).toHaveText("正在準備音訊");
  expect(await bounds(page)).toEqual(initial);
  await expect(page.getByRole("button", { name: "取消", exact: true })).toBeEnabled();
  release();
  await phase(page, "error");
  await expect(primary(page)).toHaveText("重試本段");
  await expect(page.getByRole("alert")).toHaveCount(1);
  expect(await bounds(page)).toEqual(initial);
  await page.unroute("**/api/tts");
  await primary(page).click();
  await phase(page, "playing");
  await expect(primary(page)).toHaveText("暫停");
  expect(await bounds(page)).toEqual(initial);
  await primary(page).click();
  await phase(page, "paused");
  await expect(primary(page)).toHaveText("繼續播放");
  expect(await bounds(page)).toEqual(initial);
  await page.evaluate(() => {
    window.audioTest.rejectNext = true;
  });
  const count = requests.length;
  await primary(page).click();
  await phase(page, "blocked");
  await expect(primary(page)).toHaveText("點一下播放");
  await expect(page.getByRole("alert")).toHaveCount(1);
  expect(await bounds(page)).toEqual(initial);
  await primary(page).click();
  await phase(page, "playing");
  expect(requests.length).toBe(count);
  // A real visibility event is handled by the production controller.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await phase(page, "interrupted");
  await expect(primary(page)).toHaveText("繼續播放");
  await expect(page.getByRole("alert")).toContainText("鎖屏");
  expect(await bounds(page)).toEqual(initial);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await phase(page, "interrupted");
  await primary(page).click();
  await phase(page, "playing");
  await finish(page);
  await phase(page, "waiting");
  expect(await bounds(page)).toEqual(initial);
  await primary(page).click();
  await phase(page, "playing");
  await finish(page);
  await phase(page, "complete");
  expect(await bounds(page)).toEqual(initial);
});

test("cancel preparing permits a fresh retry and ignores late synthesis", async ({ page }) => {
  await enter(page, 1.5);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let pending = false;
  await page.route("**/api/tts", async (route) => {
    pending = true;
    await held;
    await route.fallback();
  });
  await primary(page).click();
  await phase(page, "loading");
  await expect.poll(() => pending).toBe(true);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await phase(page, "idle");
  release();
  await page.unroute("**/api/tts");
  await primary(page).click();
  await phase(page, "playing");
  expect(await page.evaluate(() => window.audioTest.outputCount())).toBe(1);
});

test("selection stops the previous segment; played badges follow IDs and content versions", async ({
  page,
}) => {
  await enter(page);
  const requests = await calls(page);
  await primary(page).click();
  await phase(page, "playing");
  await finish(page);
  await phase(page, "waiting");
  await expect(page.getByRole("button", { name: /選擇第 1 段 · 已播放/ })).toBeVisible();
  await primary(page).click();
  await phase(page, "playing");
  await page.getByRole("button", { name: /選擇第 1 段 · 已播放/ }).click();
  await phase(page, "idle");
  expect(await page.evaluate(() => window.audioTest.outputCount())).toBe(0);
  await goToStep(page, "校對");
  await page.getByLabel("口白文字", { exact: true }).first().fill("更新文字版本。");
  await goToStep(page, "朗讀");
  await expect(page.getByRole("button", { name: /選擇第 1 段 · 已播放/ })).toHaveCount(0);
  const count = requests.length;
  await page.getByRole("button", { name: "下一段", exact: true }).click();
  await phase(page, "idle");
  expect(requests.length).toBe(count);
});

test("seek is disabled until PCM EOF, then preserves pause and reuses the WAV", async ({
  page,
}) => {
  await enter(page);
  const requests = await calls(page);
  await page.evaluate(() => {
    window.audioTest.holdStream = true;
  });
  await primary(page).click();
  await phase(page, "playing");
  const slider = page.locator(".playback-seek");
  await expect(slider).toBeDisabled();
  await expect(page.locator(".playback-clock")).not.toContainText("/");
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await primary(page).click();
  await phase(page, "paused");
  await page.evaluate(() => window.audioTest.closeStream?.());
  await expect(slider).toBeEnabled();
  await slider.focus();
  await slider.press("End");
  await phase(page, "paused");
  await expect(slider).toHaveValue("8");
  await slider.press("Home");
  await slider.press("ArrowRight");
  await expect(slider).toHaveValue("0.1");
  const before = requests.length;
  await primary(page).click();
  await phase(page, "playing");
  expect(requests.length).toBe(before);
  await expect(page.getByRole("progressbar")).toBeVisible();
  expect(await page.evaluate(() => window.audioTest.outputCount())).toBe(1);
});

test("settings changes explain next playback and preserve the current voice, rate and position", async ({
  page,
}) => {
  await enter(page, 1.5);
  const requests = await calls(page);
  await primary(page).click();
  await phase(page, "playing");
  await primary(page).click();
  const sheet = await openSettings(page);
  await sheet.getByLabel("朗讀聲音").selectOption("Puck");
  await sheet.getByRole("radio", { name: "0.75 倍" }).check();
  await closeSettings(page);
  await expect(page.getByText(/下一次播放套用：.*Puck.*0.75/)).toBeVisible();
  await expect(
    page
      .locator(".playback-settings-summary")
      .getByText("非 1 倍速會先產生整段音訊再播放，並保留原本的音高。", { exact: true }),
  ).toBeVisible();
  const count = requests.filter((entry) => entry.body.text === segments[0]?.text).length;
  await primary(page).click();
  await phase(page, "playing");
  expect(requests.filter((entry) => entry.body.text === segments[0]?.text).length).toBe(count);
  expect(await page.evaluate(() => window.audioTest.audio.playbackRate)).toBe(1.5);
  await page.getByRole("button", { name: "重播本段", exact: true }).click();
  await phase(page, "playing");
  expect(requests.at(-1)?.body.voice).toBe("Puck");
  expect(await page.evaluate(() => window.audioTest.audio.playbackRate)).toBe(0.75);
  await expect(page.getByText(/下一次播放套用/)).toHaveCount(0);
});

test("main, review and sample share one output; closing a preview cannot stop a different owner", async ({
  page,
}) => {
  await enter(page);
  await primary(page).click();
  await phase(page, "playing");
  const sheet = await openSettings(page);
  await sheet.getByRole("button", { name: "試聽這個聲音" }).click();
  await expect(sheet.getByRole("button", { name: "暫停", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.audioTest.outputCount())).toBe(1);
  await closeSettings(page);
  await phase(page, "idle");
  expect(await page.evaluate(() => window.audioTest.outputCount())).toBe(0);
  await goToStep(page, "校對");
  const previews = page.locator(".speech-preview");
  await previews.first().getByRole("button", { name: "產生試聽" }).click();
  await expect(previews.first().getByRole("button", { name: "暫停", exact: true })).toBeVisible();
  await previews.nth(1).getByRole("button", { name: "產生試聽" }).click();
  await expect(previews.first().getByRole("button", { name: "產生試聽" })).toBeVisible();
  await expect(previews.nth(1).getByRole("button", { name: "暫停", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.audioTest.outputCount())).toBe(1);
  // Editing another preview must not stop the active segment's audition.
  await page.getByLabel("口白文字", { exact: true }).first().fill("更動其他段落。");
  await expect(previews.nth(1).getByRole("button", { name: "暫停", exact: true })).toBeVisible();
  await goToStep(page, "朗讀");
  await primary(page).click();
  await phase(page, "playing");
  expect(await page.evaluate(() => window.audioTest.outputCount())).toBe(1);
});

test("Space and paging keys respect focus, sheets, repeat and route scope", async ({ page }) => {
  await enter(page);
  await page.locator(".playback-position").focus();
  await page.keyboard.press("Space");
  await phase(page, "playing");
  await page.keyboard.press("Space");
  await phase(page, "paused");
  await page.evaluate(() =>
    document
      .querySelector(".playback-position")
      ?.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", repeat: true, bubbles: true })),
  );
  await phase(page, "paused");
  await primary(page).focus();
  await page.keyboard.press("Space");
  await phase(page, "playing"); // The button click only, without a second global toggle.
  await page.locator(".playback-position").focus();
  await page.keyboard.press("ArrowRight");
  await phase(page, "idle");
  await expect(page.locator(".playback-position")).toContainText("第 2 段");
  expect(await page.evaluate(() => window.audioTest.outputCount())).toBe(0);
  const sheet = await openSettings(page);
  const select = sheet.getByLabel("朗讀聲音");
  await select.focus();
  await page.keyboard.press("ArrowLeft");
  await page.evaluate(() =>
    document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true })),
  );
  await expect(page.locator(".playback-position")).toContainText("第 2 段");
  await closeSettings(page);
  await page.locator(".playback-position").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".playback-position")).toContainText("第 1 段");
  await page.evaluate(() => {
    const field = document.createElement("div");
    field.contentEditable = "true";
    field.id = "keyboard-contenteditable";
    document.querySelector(".playback-script")?.append(field);
    field.focus();
  });
  await page.keyboard.press("Space");
  await phase(page, "idle");
  await goToStep(page, "校對");
  const input = page.getByLabel("口白文字", { exact: true }).first();
  await input.focus();
  await page.keyboard.press("Space");
  await expect(input).toHaveValue(`${segments[0]?.text} `);
  expect(await page.evaluate(() => window.audioTest.outputCount())).toBe(0);
});

for (const width of [320, 1180, 1280])
  test(`completion semantics, export, Back and actions at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 820 });
    await enter(page, 1.5);
    await page.getByRole("button", { name: "下一段", exact: true }).click();
    await primary(page).click();
    await phase(page, "playing");
    await finish(page);
    await phase(page, "complete");
    await primary(page).click();
    await expect(page).toHaveURL(/\/finished$/);
    await expect(page.getByRole("heading", { name: "故事唸完了" })).toBeFocused();
    await expect(page.getByText("播放了 1 / 2 段", { exact: true })).toBeVisible();
    await expect(page.getByText("播放總長 00:05", { exact: true })).toBeVisible();
    const summary = await page.locator(".finished-summary").boundingBox();
    const dirty = await page.locator(".finished-unexported").boundingBox();
    const exportButton = await page.locator(".finished-unexported .button").boundingBox();
    const actions = await page.locator(".finished-actions").boundingBox();
    expect(dirty?.y).toBeGreaterThan((summary?.y ?? 0) + (summary?.height ?? 0));
    expect(exportButton?.x).toBeGreaterThan(dirty?.x ?? 0);
    expect(actions?.y).toBeGreaterThan((dirty?.y ?? 0) + (dirty?.height ?? 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.goBack();
    await expect(page).toHaveURL(/\/play$/);
    await phase(page, "idle");
    await expect(page.locator(".playback-position")).toContainText("第 2 段");
    expect(await page.evaluate(() => window.audioTest.outputCount())).toBe(0);
    if (width >= 900) {
      const script = await page.locator(".playback-script").boundingBox();
      const controls = await page.locator(".playback-controls").boundingBox();
      expect((script?.x ?? 0) + (script?.width ?? 0)).toBeLessThan(controls?.x ?? 0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.goForward();
    await expect(page).toHaveURL(/\/finished$/);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "匯出草稿" }).click();
    await download;
    await expect(page.locator(".finished-unexported")).toHaveCount(0);
    await page.getByRole("button", { name: "準備下一段故事", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: "準備下一段故事？" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "取消", exact: true }).last().click();
    await expect(page).toHaveURL(/\/finished$/);
    await page.getByRole("button", { name: "返回校對", exact: true }).click();
    await expect(page).toHaveURL(/\/review$/);
    await goToStep(page, "朗讀");
    await primary(page).click();
    await phase(page, "playing");
    await finish(page);
    await phase(page, "complete");
    await primary(page).click();
    await page.getByRole("button", { name: "從頭再唸一次" }).click();
    await phase(page, "idle");
    await expect(page.locator(".playback-position")).toContainText("第 1 段");
    await expect(page.getByRole("button", { name: /已播放/ })).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/\/review$/);
    await page.goForward();
    await phase(page, "idle");
  });

test("all-played completion and export-first new story clear safely", async ({ page }) => {
  await enter(page, 1.5);
  await primary(page).click();
  await phase(page, "playing");
  await finish(page);
  await phase(page, "waiting");
  await primary(page).click();
  await phase(page, "playing");
  await finish(page);
  await phase(page, "complete");
  await primary(page).click();
  await expect(page.getByText("2 段全部播放完畢", { exact: true })).toBeVisible();
  await expect(page.getByText("播放總長 00:10", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "準備下一段故事", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "準備下一段故事？" });
  const download = page.waitForEvent("download");
  await sheet.getByRole("button", { name: "先匯出，再繼續" }).click();
  await download;
  await expect(page).toHaveURL(/\/finished$/);
  await sheet.getByRole("button", { name: "開始新故事", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "朗讀", exact: true })).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
});

test("finished route guards a missing draft and an unfinished reading", async ({ page }) => {
  await mockSignedInApi(page);
  await page.goto("/finished");
  await expect(page).toHaveURL(/\/$/);
  await recognize(page);
  await page.evaluate(() => {
    const link = document.createElement("a");
    link.href = "/finished";
    link.textContent = "Open completion";
    link.style.cssText = "position:fixed;top:0;left:0;z-index:1000;background:white;padding:8px";
    document.body.append(link);
  });
  await page.getByRole("link", { name: "Open completion", exact: true }).click();
  await expect(page).toHaveURL(/\/play$/);
  await expect(primary(page)).toHaveText("播放此段");
});

test("identical preview content has one active control and one alert", async ({ page }) => {
  await enter(page);
  await goToStep(page, "校對");
  await page
    .getByLabel("口白文字", { exact: true })
    .nth(1)
    .fill(segments[0]?.text ?? "");
  await page
    .getByLabel("朗讀語氣", { exact: true })
    .nth(1)
    .fill(segments[0]?.suggestedToneHint ?? "");
  await page.route("**/api/tts", (route) =>
    route.fulfill({ status: 503, json: { error: "Unavailable" } }),
  );
  await page.locator(".speech-preview").first().getByRole("button", { name: "產生試聽" }).click();
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(
    page.locator(".speech-preview").nth(1).getByRole("button", { name: "產生試聽" }),
  ).toBeVisible();
});

test("full WAV seeking and leaving playback preserve ownership and release the wake lock", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const log: string[] = [];
    Object.assign(window, { playbackWakeLog: log });
    localStorage.setItem("bragi-keep-awake", "true");
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: {
        request: async () => {
          log.push("request");
          return {
            released: false,
            release: async () => {
              log.push("release");
            },
            addEventListener() {},
          };
        },
      },
    });
  });
  await enter(page, 1.5);
  await primary(page).click();
  await phase(page, "playing");
  const slider = page.locator(".playback-seek");
  await expect(slider).toBeEnabled();
  await slider.focus();
  await slider.press("End");
  await phase(page, "playing");
  await expect(slider).toHaveValue("8");
  await primary(page).click();
  await phase(page, "paused");
  await slider.focus();
  await slider.press("Home");
  await phase(page, "paused");
  await expect(slider).toHaveValue("0");
  await primary(page).click();
  await phase(page, "playing");
  await goToStep(page, "校對");
  expect(await page.evaluate(() => window.audioTest.outputCount())).toBe(0);
  expect(
    await page.evaluate(() => (window as unknown as { playbackWakeLog: string[] }).playbackWakeLog),
  ).toEqual(["request", "release"]);
});

test("an in-flight next WAV survives ended and joins the next click without another synthesis", async ({
  page,
}) => {
  await enter(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let preloadCalls = 0;
  let streamCalls = 0;
  await page.route("**/api/tts", async (route) => {
    if (route.request().postDataJSON().text === segments[1]?.text) {
      preloadCalls += 1;
      await held;
    }
    await route.fallback();
  });
  await page.route("**/api/tts-stream", async (route) => {
    streamCalls += 1;
    await route.fallback();
  });
  await primary(page).click();
  await phase(page, "playing");
  await expect.poll(() => preloadCalls).toBe(1);
  await finish(page);
  await phase(page, "waiting");
  expect(preloadCalls).toBe(1);
  await primary(page).click();
  await phase(page, "loading");
  release();
  await phase(page, "playing");
  expect(preloadCalls).toBe(1);
  expect(streamCalls).toBe(1);
});

test("a PCM tail already at EOF on resume reports completion instead of remaining in loading", async ({
  page,
}) => {
  await enter(page);
  await primary(page).click();
  await phase(page, "playing");
  await page.evaluate(() => window.audioTest.contexts.at(-1)?.advance(8));
  await primary(page).click();
  await phase(page, "paused");
  await primary(page).click();
  await phase(page, "waiting");
  await expect(page.getByRole("button", { name: /選擇第 1 段 · 已播放/ })).toBeVisible();
});

test("dismissing a toast does not move narration controls", async ({ page }) => {
  await enter(page);
  const before = await bounds(page);
  await page.mouse.move(0, 0);
  await page.locator(".toast").dispatchEvent("pointerleave");
  await expect(page.locator(".toast")).toHaveClass(/toast-empty/, { timeout: 8000 });
  expect(await bounds(page)).toEqual(before);
});
