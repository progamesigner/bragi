import { expect, test } from "@playwright/test";
import {
  closeSettings,
  goToStep,
  mockSignedInApi,
  openSettings,
  recognize,
  selectImage,
  settingsButton,
  steps,
} from "./fixtures";

for (const path of ["/review", "/play"]) {
  test(`a fresh deep link to ${path} returns to capture after checking the session`, async ({
    page,
  }) => {
    await mockSignedInApi(page);
    await page.goto(path);
    await expect(page).toHaveURL(/\/$/);
    await expect(steps(page).getByRole("link", { name: "取圖" })).toHaveAttribute(
      "aria-current",
      "step",
    );
    await expect(steps(page).getByRole("link", { name: "校對" })).toHaveCount(0);
    await expect(
      steps(page).locator(".step-unavailable").filter({ hasText: "校對" }),
    ).toHaveAttribute("aria-disabled", "true");
    await recognize(page);
    await page.reload();
    await expect(page).toHaveURL(/\/$/);
    await page.getByRole("button", { name: "恢復上次的草稿" }).click();
    await expect(page).toHaveURL(/\/review$/);
    await expect(page.getByLabel("口白文字", { exact: true })).toHaveCount(2);
  });
}

test("route history keeps edits, reading position and the review scroll position", async ({
  page,
}) => {
  await mockSignedInApi(page);
  await page.goto("/");
  await recognize(page);
  await expect(page.locator(".top-nav .wordmark")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "上一頁" })).toHaveAttribute("href", "/");
  await page.getByLabel("朗讀語氣").first().fill("新語氣");
  await page.getByLabel("口白文字", { exact: true }).last().scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => window.scrollY);
  expect(scroll).toBeGreaterThan(0);
  await goToStep(page, "朗讀");
  await page.getByRole("button", { name: "下一段", exact: true }).click();
  await page.goBack();
  await expect(page).toHaveURL(/\/review$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scroll);
  await expect(page.getByLabel("朗讀語氣").first()).toHaveValue("新語氣");
  await page.goForward();
  await expect(page.getByRole("heading", { name: "第 2 段，共 2 段" })).toBeVisible();
  await page.getByRole("link", { name: "上一頁" }).click();
  await expect(page).toHaveURL(/\/review$/);
  await page.locator("#main").getByRole("button", { name: "復原", exact: true }).click();
  await expect(page.getByLabel("朗讀語氣").first()).toHaveValue("低沉、緩慢");
});

test("OTP paste submits once, blocks a rejected code and keeps the surrounding layout still", async ({
  page,
}) => {
  await mockSignedInApi(page, { authenticated: false });
  let attempts = 0;
  let finish!: () => void;
  await page.route("**/api/session", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { authenticated: false } });
    attempts += 1;
    if (attempts === 1) {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return route.fulfill({
        status: 401,
        json: { error: { code: "INVALID_OTP", retryable: false } },
      });
    }
    return route.fulfill({ json: { authenticated: true, voices: ["Kore", "Puck"] } });
  });
  await page.goto("/");
  const input = page.getByLabel("驗證碼");
  await expect(input).toHaveAttribute("autocomplete", "one-time-code");
  await expect(input).toHaveAttribute("inputmode", "numeric");
  const positions = () =>
    page.evaluate(() =>
      [".sign-in-intro", ".sign-in-language"].map(
        (selector) => document.querySelector(selector)?.getBoundingClientRect().y,
      ),
    );
  const before = await positions();
  await input.fill("１２３ ４５６");
  await expect.poll(() => attempts).toBe(1);
  await expect(page.getByRole("button", { name: "登入", exact: true })).toBeDisabled();
  await input.press("Enter");
  expect(attempts).toBe(1);
  expect(await positions()).toEqual(before);
  finish();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("alert")).toHaveCount(1);
  expect(await positions()).toEqual(before);
  await input.fill("123456");
  await input.press("Enter");
  expect(attempts).toBe(1);
  await input.fill("654321");
  await expect(page.getByRole("button", { name: "開始使用" })).toBeFocused();
  expect(attempts).toBe(2);
  expect(await positions()).toEqual(before);
  await page.getByRole("button", { name: "開始使用" }).click();
  await expect(settingsButton(page)).toBeVisible();
});

for (const api of ["ocr", "tts-stream"]) {
  test(`${api} expiry has one alert, keeps the draft and waits for a manual retry after reauthentication`, async ({
    page,
  }) => {
    await mockSignedInApi(page);
    await page.goto("/");
    await recognize(page);
    await page.getByLabel("口白文字", { exact: true }).first().fill("保留修改。");
    let expired = true;
    let attempts = 0;
    await page.route(`**/api/${api}`, async (route) => {
      attempts += 1;
      if (expired)
        return route.fulfill({
          status: 401,
          json: { error: { code: "UNAUTHORIZED", retryable: false } },
        });
      return route.fallback();
    });
    if (api === "ocr") {
      await goToStep(page, "取圖");
      await selectImage(page);
      await page.getByRole("button", { name: /^(辨識文字|重新辨識)$/ }).click();
    } else {
      await goToStep(page, "朗讀");
      await page.getByRole("button", { name: "播放此段" }).click();
    }
    const path = page.url();
    await expect(page.getByRole("alert")).toHaveCount(1);
    await expect(page.getByRole("alert")).toContainText("草稿與目前畫面都保留著");
    await page.getByRole("button", { name: "重新登入", exact: true }).click();
    expired = false;
    const sheet = page.getByRole("dialog", { name: "重新登入" });
    await sheet.getByLabel("驗證碼").fill("123456");
    await expect(sheet).toBeHidden();
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(page.url()).toBe(path);
    expect(attempts).toBe(1);
    if (api === "ocr") {
      await page.getByRole("button", { name: /^(辨識文字|重新辨識)$/ }).click();
      await page
        .getByRole("dialog", { name: "取代目前稿件？" })
        .getByRole("button", { name: "取消", exact: true })
        .last()
        .click();
      await expect(page.getByText("已保留目前稿件；候選圖片可重新辨識")).toBeVisible();
    } else {
      await page.getByRole("button", { name: "重試本段" }).click();
      await expect(page.getByRole("button", { name: "重播本段" })).toBeVisible();
    }
    expect(attempts).toBe(2);
    await goToStep(page, "校對");
    await expect(page.getByLabel("口白文字", { exact: true }).first()).toHaveValue("保留修改。");
  });
}

for (const action of ["清除目前內容", "登出"] as const) {
  test(`${action} exports first and requires a separate confirmation`, async ({ page }) => {
    await mockSignedInApi(page);
    await page.goto("/");
    await recognize(page);
    const settings = await openSettings(page);
    await settings.getByRole("button", { name: action, exact: true }).click();
    const sheet = page.getByRole("dialog", { name: `${action}？` });
    const download = page.waitForEvent("download");
    await sheet.getByRole("button", { name: "先匯出，再繼續" }).click();
    expect((await download).suggestedFilename()).toMatch(/\.json$/);
    await expect(sheet).toBeVisible();
    expect(page.url()).toMatch(/\/review$/);
    await sheet
      .getByRole("button", { name: action === "登出" ? "繼續登出" : "繼續清除", exact: true })
      .click();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByLabel(action === "登出" ? "驗證碼" : "選擇圖片")).toBeAttached();
    expect(await page.evaluate(() => localStorage.getItem("bragi:autosave:v1"))).toBeNull();
  });
}

test("a failed sign-out keeps the draft, candidate picture and local recovery copy", async ({
  page,
}) => {
  await mockSignedInApi(page);
  await page.goto("/");
  await recognize(page);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("bragi:autosave:v1")))
    .not.toBeNull();
  await goToStep(page, "取圖");
  await selectImage(page);
  await page.route("**/api/session", (route) =>
    route.request().method() === "DELETE"
      ? route.fulfill({
          status: 503,
          json: { error: { code: "SERVICE_UNAVAILABLE", retryable: true } },
        })
      : route.fallback(),
  );
  const settings = await openSettings(page);
  await settings.getByRole("button", { name: "登出", exact: true }).click();
  await page
    .getByRole("dialog", { name: "登出？" })
    .getByRole("button", { name: "不匯出，直接登出" })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByAltText("準備上傳的圖片預覽")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("bragi:autosave:v1"))).not.toBeNull();
  await goToStep(page, "校對");
  await expect(page.getByLabel("口白文字", { exact: true })).toHaveCount(2);
});

test("settings trial pauses narration, stops on close and cancels a pending trial", async ({
  page,
}) => {
  await mockSignedInApi(page);
  await page.route("**/api/tts-stream", (route) =>
    route.fulfill({
      contentType: "audio/l16",
      headers: { "x-audio-sample-rate": "24000" },
      body: Buffer.alloc(480_000),
    }),
  );
  await page.goto("/");
  await recognize(page);
  await goToStep(page, "朗讀");
  await page.getByRole("button", { name: "播放此段" }).click();
  await expect(page.getByRole("button", { name: "暫停", exact: true })).toBeVisible();
  const settings = await openSettings(page);
  await settings.getByRole("button", { name: "試聽這個聲音" }).click();
  await expect(settings.getByLabel("聲音試聽", { exact: true }).getByRole("slider")).toBeEnabled();
  await closeSettings(page);
  expect(
    await page.evaluate(
      () => (window as unknown as { bragiAudio: HTMLAudioElement }).bragiAudio.paused,
    ),
  ).toBe(true);
  // A new owner stops the old intent. Starting main again is an explicit playback action.
  await expect(page.getByRole("button", { name: "播放此段", exact: true })).toBeVisible();
  await openSettings(page);
  await settings.getByLabel("朗讀聲音").selectOption("Puck");
  await page.route("**/api/tts", (route) =>
    route.request().postDataJSON().text ? new Promise(() => {}) : route.fallback(),
  );
  await settings.getByRole("button", { name: "試聽這個聲音" }).click();
  await expect(settings.getByRole("button", { name: "產生中…" })).toBeDisabled();
  await closeSettings(page);
  await openSettings(page);
  await expect(settings.getByRole("button", { name: "試聽這個聲音" })).toBeEnabled();
});

test("capture controls fit in the first phone screen and settings change placement on tablets", async ({
  page,
}) => {
  await mockSignedInApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  for (const label of ["拍照", "選擇圖片"]) {
    // File pickers are visually hidden; measure their visible label instead.
    const target = await page
      .locator(`label[for="${await page.getByLabel(label).getAttribute("id")}"]`)
      .boundingBox();
    expect(target).not.toBeNull();
    expect((target?.y ?? 0) + (target?.height ?? 0)).toBeLessThan(844);
  }
  const sheet = await openSettings(page);
  for (const section of ["顯示", "聲音", "介面", "資料與帳號"])
    await expect(sheet.getByRole("heading", { name: section, exact: true })).toBeAttached();
  // Opening animates the drawer; measure its final position rather than an intermediate frame.
  await expect
    .poll(async () => {
      const phone = await sheet.boundingBox();
      return Math.round((phone?.y ?? 0) + (phone?.height ?? 0));
    })
    .toBe(844);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() => sheet.evaluate((element) => getComputedStyle(element).animationName))
    .toBe("none");
  await page.setViewportSize({ width: 1180, height: 820 });
  await expect
    .poll(() => sheet.evaluate((element) => getComputedStyle(element).animationName))
    .toBe("none");
  const tablet = await sheet.boundingBox();
  expect(tablet?.x).toBeGreaterThan(590);
  expect((tablet?.x ?? 0) + (tablet?.width ?? 0)).toBeLessThanOrEqual(1180);
  expect((tablet?.x ?? 0) + (tablet?.width ?? 0)).toBeGreaterThan(1140);
  expect(tablet?.height).toBeGreaterThan(738);
});

test("a waiting app update uses export-first protection and preserves the local text copy", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const messages: string[] = [];
    const worker = { postMessage: (message: string) => messages.push(message) };
    const serviceWorker = new EventTarget();
    Object.assign(serviceWorker, {
      register: async () => Object.assign(new EventTarget(), { waiting: worker }),
    });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: serviceWorker });
    Object.assign(window, { updateMessages: messages });
  });
  await mockSignedInApi(page);
  await page.goto("/");
  await recognize(page);
  const messages = () =>
    page.evaluate(() => (window as unknown as { updateMessages: string[] }).updateMessages);
  await page.getByRole("button", { name: "更新並重新載入" }).click();
  const sheet = page.getByRole("dialog", { name: "更新 Bragi？" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("本機暫存仍保留文字草稿");
  const download = page.waitForEvent("download");
  await sheet.getByRole("button", { name: "先匯出，再繼續" }).click();
  await download;
  expect(await messages()).toEqual([]);
  await sheet.getByRole("button", { name: "繼續更新", exact: true }).click();
  await expect.poll(messages).toEqual(["ACTIVATE_UPDATE"]);
  expect(await page.evaluate(() => localStorage.getItem("bragi:autosave:v1"))).not.toBeNull();
});

test("a focused toast action stays available and expires when another edit changes history", async ({
  page,
}) => {
  await mockSignedInApi(page);
  await page.goto("/");
  await recognize(page);
  await page
    .getByRole("button", { name: /刪除段落/ })
    .last()
    .click();
  const action = page.locator(".toast").getByRole("button", { name: "復原" });
  await action.focus();
  // Longer than the 6-second toast lifetime; focus must keep its action reachable.
  await page.waitForTimeout(6100);
  await expect(action).toBeFocused();
  await action.click();
  await expect(page.getByLabel("口白文字", { exact: true })).toHaveCount(2);
  await page
    .getByRole("button", { name: /刪除段落/ })
    .last()
    .click();
  await expect(action).toBeVisible();
  await page.getByLabel("口白文字", { exact: true }).first().fill("後來的修改不能被舊操作復原。");
  await expect(action).toHaveCount(0);
  await expect(page.getByLabel("口白文字", { exact: true }).first()).toHaveValue(
    "後來的修改不能被舊操作復原。",
  );
});

test.describe("screen transitions", () => {
  async function recordFades(page: import("@playwright/test").Page) {
    await page.addInitScript(() => {
      const log: { keyframes: string[]; duration: number; at: number }[] = [];
      const focus: { tag: string; at: number }[] = [];
      Object.assign(window, { fadeLog: log, focusLog: focus });
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (keyframes, options) {
        if (this.id === "main")
          log.push({
            keyframes: (keyframes as Keyframe[]).flatMap((frame) => Object.keys(frame)),
            duration: typeof options === "number" ? options : Number(options?.duration),
            at: performance.now(),
          });
        return animate.call(this, keyframes, options);
      };
      addEventListener("focusin", (event) =>
        focus.push({ tag: (event.target as Element).tagName, at: performance.now() }),
      );
    });
  }
  const fades = (page: import("@playwright/test").Page) =>
    page.evaluate(
      () => (window as unknown as { fadeLog: { keyframes: string[]; duration: number }[] }).fadeLog,
    );

  test("moving between steps fades the screen in briefly without delaying focus", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await recordFades(page);
    await mockSignedInApi(page);
    await page.goto("/");
    expect(await fades(page)).toEqual([]);
    await recognize(page);
    await goToStep(page, "朗讀");
    await expect(page.getByRole("heading", { name: "第 1 段，共 2 段" })).toBeFocused();
    await page.goBack();
    await expect(page).toHaveURL(/\/review$/);
    const log = await fades(page);
    expect(log).toHaveLength(3);
    for (const fade of log) {
      expect(fade.keyframes.every((property) => property === "opacity")).toBe(true);
      expect(fade.duration).toBeLessThanOrEqual(200);
    }
    // Headings take focus while the fade is still running, not after it.
    const { fadeLog, focusLog } = await page.evaluate(() => {
      const logs = window as unknown as {
        fadeLog: { at: number; duration: number }[];
        focusLog: { tag: string; at: number }[];
      };
      return { fadeLog: logs.fadeLog, focusLog: logs.focusLog };
    });
    for (const fade of fadeLog.slice(0, 2)) {
      const heading = focusLog.find((entry) => entry.tag === "H1" && entry.at >= fade.at - 50);
      expect(heading?.at).toBeLessThan(fade.at + fade.duration);
    }
  });

  test("reduced motion turns screen fades off", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await recordFades(page);
    await mockSignedInApi(page);
    await page.goto("/");
    await recognize(page);
    await goToStep(page, "朗讀");
    await expect(page.getByRole("heading", { name: "第 1 段，共 2 段" })).toBeFocused();
    expect(await fades(page)).toEqual([]);
  });
});
