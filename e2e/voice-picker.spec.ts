import { expect, type Page, test } from "@playwright/test";
import { VOICE_CATALOG } from "../src/lib/voices";
import { mockAudio } from "./audio-fixture";
import {
  closeSettings,
  mockSignedInApi,
  openSettings,
  openVoicePicker,
  recognize,
  segments,
  settingsSheet,
  voicePicker,
} from "./fixtures";

const ALL = ["Kore", ...VOICE_CATALOG.map(([name]) => name).filter((name) => name !== "Kore")];

type Call = { path: string; voice?: string; text: string };

/** Signed in with the whole catalog; records speech requests and whether the page aborted them. */
async function enter(page: Page, { holdSamples = false } = {}) {
  await mockSignedInApi(page);
  await mockAudio(page);
  await page.route("**/api/session", (route) =>
    route.fulfill({ json: { authenticated: true, voices: ALL } }),
  );
  const calls: Call[] = [];
  await page.route("**/api/tts*", async (route) => {
    const body = route.request().postDataJSON();
    calls.push({ path: new URL(route.request().url()).pathname, ...body });
    if (holdSamples && body.text !== segments[0]?.text && body.text !== segments[1]?.text) return;
    await route.fallback();
  });
  await page.addInitScript(() => {
    const aborted: string[] = [];
    const fetcher = window.fetch.bind(window);
    window.fetch = (input, init) => {
      init?.signal?.addEventListener("abort", () => {
        aborted.push(JSON.parse(String(init.body ?? "{}")).voice ?? "");
      });
      return fetcher(input, init);
    };
    Object.assign(window, { abortedSpeech: aborted });
  });
  await page.goto("/");
  return calls;
}
const samples = (calls: Call[]) => calls.filter((call) => call.text !== segments[0]?.text);
const row = (page: Page, name: string) =>
  voicePicker(page)
    .locator(".voice-option")
    .filter({ has: page.locator(`input[value="${name}"]`) });
const preview = (page: Page, action: string, name: string) =>
  voicePicker(page).getByRole("button", { name: `${action} ${name}`, exact: true });
const outputs = (page: Page) => page.evaluate(() => window.audioTest.outputCount());

test("lists all 30 voices, marks the one in use and filters by official trait or name", async ({
  page,
}) => {
  const calls = await enter(page);
  const picker = await openVoicePicker(page);
  const radios = picker.getByRole("radio");
  await expect(radios).toHaveCount(30);
  await expect(picker.getByRole("radio", { name: "Kore · 堅定 · 預設" })).toBeChecked();
  await expect(picker.getByText("目前使用：Kore · 堅定")).toBeVisible();
  await expect(row(page, "Kore").getByText("使用中", { exact: true })).toBeVisible();
  await expect(picker.locator(".voice-badge-current")).toHaveCount(1);
  await expect(picker.getByRole("status").first()).toHaveText("顯示 30 個聲音，共 30 個");

  const trait = picker.getByLabel("依特質篩選");
  await expect(trait.locator("option")).toHaveCount(23);
  await trait.selectOption({ label: "堅定（3）" });
  await expect(radios).toHaveCount(3);
  expect(
    await radios.evaluateAll((items) => items.map((item) => (item as HTMLInputElement).value)),
  ).toEqual(["Alnilam", "Kore", "Orus"]);

  await trait.selectOption("");
  const search = picker.getByLabel("搜尋名稱或特質");
  await search.fill("puc");
  await expect(radios).toHaveCount(1);
  await expect(picker.getByRole("radio", { name: "Puck · 輕快" })).toBeVisible();
  await search.fill("溫暖");
  await expect(picker.getByRole("radio")).toHaveCount(1);
  await expect(picker.getByRole("radio", { name: "Sulafat · 溫暖" })).toBeVisible();
  await search.fill("nobody");
  await expect(radios).toHaveCount(0);
  await expect(picker.getByText("沒有符合的聲音")).toBeVisible();
  await picker.getByRole("button", { name: "清除搜尋與篩選" }).click();
  await expect(radios).toHaveCount(30);
  await expect(search).toHaveValue("");

  // Opening, filtering and searching never synthesizes a single sample.
  expect(calls).toHaveLength(0);
});

test("every voice can be chosen, the choice is remembered and the next playback uses it", async ({
  page,
}) => {
  const calls = await enter(page);
  const picker = await openVoicePicker(page);
  for (const name of ALL) {
    await picker.locator(`input[value="${name}"]`).check();
    await expect(picker.locator(".voice-picker-current")).toHaveText(
      new RegExp(`^目前使用：${name} · `),
    );
    await expect(picker.locator("input:checked")).toHaveValue(name);
  }
  // Kore is the server default, so choosing it stores "use the default".
  await picker.locator('input[value="Kore"]').check();
  expect(await page.evaluate(() => localStorage.getItem("bragi-voice"))).toBe("");
  await picker.locator('input[value="Sulafat"]').check();
  await expect(picker.getByText("從下一次播放開始使用")).toBeVisible();
  await picker.getByRole("button", { name: "完成", exact: true }).click();
  await expect(
    settingsSheet(page).getByRole("button", { name: "朗讀聲音 Sulafat · 溫暖 更換" }),
  ).toBeFocused();
  expect(calls).toHaveLength(0);

  await page.reload();
  await openVoicePicker(page);
  await expect(voicePicker(page).locator("input:checked")).toHaveValue("Sulafat");
  await page.keyboard.press("Escape");
  await closeSettings(page);
  await recognize(page);
  await page.getByRole("button", { name: /^進入朗讀/ }).click();
  await page.locator(".playback-primary").click();
  await expect(page.locator(".playback")).toHaveAttribute("data-phase", "playing");
  expect(calls.find((call) => call.path === "/api/tts-stream")?.voice).toBe("Sulafat");
  expect(calls.every((call) => call.voice === "Sulafat")).toBe(true);
});

test("previews only on request, one voice at a time, and reuse the bounded sample cache", async ({
  page,
}) => {
  const calls = await enter(page);
  await openVoicePicker(page);
  await preview(page, "試聽", "Puck").click();
  await expect(preview(page, "停止", "Puck")).toBeVisible();
  expect(samples(calls).map((call) => call.voice)).toEqual(["Puck"]);
  expect(await outputs(page)).toBe(1);
  // Previewing never changes the voice in use.
  await expect(voicePicker(page).locator("input:checked")).toHaveValue("Kore");

  await preview(page, "試聽", "Zephyr").click();
  await expect(preview(page, "停止", "Zephyr")).toBeVisible();
  await expect(preview(page, "試聽", "Puck")).toBeVisible();
  expect(await outputs(page)).toBe(1);
  await expect(voicePicker(page).locator(".voice-sample-compact[data-phase=playing]")).toHaveCount(
    1,
  );

  await preview(page, "停止", "Zephyr").click();
  await expect(preview(page, "試聽", "Zephyr")).toBeVisible();
  expect(await outputs(page)).toBe(0);

  // A voice that was already previewed plays from the sample cache.
  await preview(page, "試聽", "Puck").click();
  await expect(preview(page, "停止", "Puck")).toBeVisible();
  expect(samples(calls).map((call) => call.voice)).toEqual(["Puck", "Zephyr"]);
  expect(calls.every((call) => call.path === "/api/tts")).toBe(true);
});

test("closing the picker or settings stops the preview and cancels its request", async ({
  page,
}) => {
  const calls = await enter(page, { holdSamples: true });
  await recognize(page);
  await openVoicePicker(page);
  await preview(page, "試聽", "Puck").click();
  await expect(preview(page, "取消", "Puck")).toBeVisible();
  await expect.poll(() => samples(calls).length).toBe(1);
  await page.keyboard.press("Escape");
  await expect(voicePicker(page)).toBeHidden();
  await expect(settingsSheet(page)).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { abortedSpeech: string[] }).abortedSpeech),
    )
    .toEqual(["Puck"]);

  // Reopening starts idle; the cancelled sample never plays late.
  await openVoicePicker(page);
  await expect(preview(page, "試聽", "Puck")).toBeVisible();
  expect(await outputs(page)).toBe(0);

  await preview(page, "試聽", "Zephyr").click();
  await expect(preview(page, "取消", "Zephyr")).toBeVisible();
  // Leaving the screen closes settings (and the picker on top of it) without either close button.
  await page.evaluate(() => history.back());
  await expect(page).toHaveURL(/\/$/);
  await expect(voicePicker(page)).toBeHidden();
  await expect(settingsSheet(page)).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { abortedSpeech: string[] }).abortedSpeech),
    )
    .toEqual(["Puck", "Zephyr"]);
  expect(await outputs(page)).toBe(0);
});

test("a playing preview stops when the picker closes, and settings' own sample yields to it", async ({
  page,
}) => {
  await enter(page);
  const sheet = await openSettings(page);
  await sheet.getByRole("button", { name: "試聽這個聲音" }).click();
  await expect(sheet.getByRole("button", { name: "暫停", exact: true })).toBeVisible();
  await openVoicePicker(page);
  // Opening the picker stops the settings sample, so only the picker's previews can sound.
  expect(await outputs(page)).toBe(0);
  await preview(page, "試聽", "Charon").click();
  await expect(preview(page, "停止", "Charon")).toBeVisible();
  expect(await outputs(page)).toBe(1);
  await voicePicker(page).getByRole("button", { name: "關閉聲音選擇" }).click();
  await expect(voicePicker(page)).toBeHidden();
  expect(await outputs(page)).toBe(0);

  await openVoicePicker(page);
  await preview(page, "試聽", "Charon").click();
  await expect(preview(page, "停止", "Charon")).toBeVisible();
  await voicePicker(page).getByRole("button", { name: "完成", exact: true }).click();
  await closeSettings(page);
  expect(await outputs(page)).toBe(0);
});

test("keyboard: arrows choose, Enter confirms, Escape closes, and focus returns to the opener", async ({
  page,
}) => {
  await enter(page);
  const sheet = await openSettings(page);
  const opener = sheet.getByRole("button", { name: /^朗讀聲音 / });
  await opener.focus();
  await page.keyboard.press("Enter");
  await expect(voicePicker(page)).toBeVisible();
  const kore = voicePicker(page).getByRole("radio", { name: "Kore · 堅定 · 預設" });
  await expect(kore).toBeFocused();

  // Alphabetically, Laomedeia follows Kore.
  await page.keyboard.press("ArrowDown");
  const laomedeia = voicePicker(page).getByRole("radio", { name: "Laomedeia · 輕快" });
  await expect(laomedeia).toBeFocused();
  await expect(laomedeia).toBeChecked();
  await page.keyboard.press("Tab");
  await expect(preview(page, "試聽", "Laomedeia")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(laomedeia).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(kore).toBeChecked();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(voicePicker(page)).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(opener).toHaveAccessibleName("朗讀聲音 Laomedeia · 輕快 更換");

  await page.keyboard.press("Space");
  await expect(laomedeia).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  const next = voicePicker(page).getByRole("radio", { name: "Leda · 年輕" });
  await expect(next).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(voicePicker(page)).toBeHidden();
  await expect(settingsSheet(page)).toBeVisible();
  await expect(opener).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(settingsSheet(page)).toBeHidden();
});

test("choosing a voice while reading leaves the current audio untouched until the next play", async ({
  page,
}) => {
  const calls = await enter(page);
  await recognize(page);
  await page.getByRole("button", { name: /^進入朗讀/ }).click();
  const reading = page.locator(".playback");
  await page.locator(".playback-primary").click();
  await expect(reading).toHaveAttribute("data-phase", "playing");
  const current = () => calls.filter((call) => call.text === segments[0]?.text);
  const before = current().length;

  const picker = await openVoicePicker(page);
  await picker.getByRole("radio", { name: "Puck · 輕快" }).check();
  await expect(reading).toHaveAttribute("data-phase", "playing");
  expect(await outputs(page)).toBe(1);
  await picker.getByRole("button", { name: "完成", exact: true }).click();
  await closeSettings(page);

  await expect(reading).toHaveAttribute("data-phase", "playing");
  expect(await outputs(page)).toBe(1);
  // The part that is playing is never requested again. The next part is prepared once more, with
  // the new voice, and that preload is kept (prefetch.spec.ts covers the request lifecycle).
  expect(current()).toHaveLength(before);
  expect(current().every((call) => call.voice === undefined)).toBe(true);
  await expect.poll(() => calls.length).toBe(3);
  expect(calls[2]).toMatchObject({ path: "/api/tts", text: segments[1]?.text, voice: "Puck" });
  expect(
    await page.evaluate(() => (window as unknown as { abortedSpeech: string[] }).abortedSpeech),
  ).not.toContain("Puck");
  await expect(page.locator(".playback-segment-button").nth(1)).toHaveAccessibleName(/已備妥$/);
  await expect(page.getByText(/下一次播放套用：.*Puck/)).toBeVisible();
  await expect(page.locator(".playback-settings-button")).toContainText("Kore");

  await page.getByRole("button", { name: "重播本段", exact: true }).click();
  await expect(reading).toHaveAttribute("data-phase", "playing");
  expect(calls.at(-1)?.voice).toBe("Puck");
});

for (const width of [390, 320]) {
  test(`fits ${width}px with 44px touch targets`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await enter(page);
    const picker = await openVoicePicker(page);
    const problems = await picker.evaluate((dialog) => {
      const found: string[] = [];
      const page = document.documentElement;
      if (page.scrollWidth > page.clientWidth) found.push("page scrolls sideways");
      if (dialog.scrollWidth > dialog.clientWidth + 1) found.push("picker scrolls sideways");
      for (const target of dialog.querySelectorAll<HTMLElement>(
        ".voice-option-choice, .voice-option button, .sheet-header button, .voice-picker > .button",
      )) {
        const box = target.getBoundingClientRect();
        // Sub-pixel layout can report 43.99…px for a 44px minimum.
        if (box.height < 43.9 || box.width < 43.9)
          found.push(`${target.textContent?.trim()} is ${box.width}×${box.height}`);
        if (box.right > page.clientWidth + 0.5)
          found.push(`${target.textContent} leaves the screen`);
      }
      return found;
    });
    expect(problems).toEqual([]);
  });
}
