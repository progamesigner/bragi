import { expect, type Page, test } from "@playwright/test";
import { mockAudio } from "./audio-fixture";
import {
  closeSettings,
  mockSignedInApi,
  moreEditing,
  openSettings,
  openVoicePicker,
  recognize,
  segments,
  settingsSheet,
  voicePicker,
} from "./fixtures";

type Speech = {
  path: string;
  part: number | "sample";
  voice?: string;
  purpose?: string;
  outcome?: "done" | "aborted";
};

/**
 * Records every speech request with its endpoint, part, voice, purpose (the controller marks play,
 * preload and preview) and whether the page aborted it. While `held`, prefetches stay in flight.
 */
async function enter(page: Page) {
  await mockSignedInApi(page);
  await mockAudio(page);
  await page.route("**/api/session", (route) =>
    route.fulfill({ json: { authenticated: true, voices: ["Kore", "Puck", "Zephyr", "Charon"] } }),
  );
  const speech: Speech[] = [];
  const requests = new Map<object, Speech>();
  const gate = { held: false, release: () => {}, opened: Promise.resolve() };
  const hold = () => {
    gate.held = true;
    gate.opened = new Promise((resolve) => {
      gate.release = () => {
        gate.held = false;
        resolve();
      };
    });
  };
  await page.route("**/api/tts*", async (route) => {
    const request = route.request();
    const body = request.postDataJSON();
    const part = segments.findIndex((segment) => segment.text === body.text);
    const entry: Speech = {
      path: new URL(request.url()).pathname,
      part: part < 0 ? "sample" : part + 1,
      voice: body.voice,
      purpose: request.headers()["x-bragi-speech-purpose"],
    };
    speech.push(entry);
    requests.set(request, entry);
    if (gate.held && entry.purpose === "prefetch") await gate.opened;
    await route.fallback().catch(() => undefined);
  });
  page.on("requestfailed", (request) => {
    const entry = requests.get(request);
    if (entry) entry.outcome = "aborted";
  });
  page.on("requestfinished", (request) => {
    const entry = requests.get(request);
    if (entry) entry.outcome = "done";
  });
  await page.goto("/");
  return { speech, hold, release: () => gate.release() };
}

const reading = (page: Page) => page.locator(".playback");
const badge = (page: Page, n: number) => page.locator(".playback-segment-button").nth(n - 1);
const prefetches = (speech: Speech[]) => speech.filter((entry) => entry.purpose === "prefetch");
const settled = (speech: Speech[]) => () => speech.map((entry) => entry.outcome ?? "open");

async function startReading(page: Page) {
  await recognize(page);
  // Reviewing and the settings sample never synthesize on their own, whatever the voice.
  await pickVoices(page, ["Zephyr", "Kore"]);
  await page.getByRole("button", { name: /^進入朗讀/ }).click();
  await page.locator(".playback-primary").click();
  await expect(reading(page)).toHaveAttribute("data-phase", "playing");
}

async function pickVoices(page: Page, names: string[]) {
  const picker = await openVoicePicker(page);
  for (const name of names)
    await picker.getByRole("radio", { name: new RegExp(`^${name} `) }).check();
  await picker.getByRole("button", { name: "完成", exact: true }).click();
  await closeSettings(page);
}

async function pickRates(page: Page, rates: string[]) {
  const sheet = await openSettings(page);
  for (const rate of rates) await sheet.getByRole("radio", { name: `${rate} 倍` }).check();
  await closeSettings(page);
}

test("choosing a voice while the next part is preparing replaces that one preload", async ({
  page,
}) => {
  const { speech, hold, release } = await enter(page);
  hold();
  await startReading(page);
  await expect.poll(() => prefetches(speech).length).toBe(1);
  await expect(badge(page, 2)).toHaveAccessibleName(/準備中$/);

  await pickVoices(page, ["Puck"]);
  await expect.poll(settled(speech)).toEqual(["done", "aborted", "open"]);
  expect(speech).toMatchObject([
    { path: "/api/tts-stream", part: 1, purpose: "playback", voice: undefined },
    { path: "/api/tts", part: 2, purpose: "prefetch", voice: undefined },
    { path: "/api/tts", part: 2, purpose: "prefetch", voice: "Puck" },
  ]);
  release();
  await expect.poll(settled(speech)).toEqual(["done", "aborted", "done"]);
  await expect(badge(page, 2)).toHaveAccessibleName(/已備妥$/);
  await expect(reading(page)).toHaveAttribute("data-phase", "playing");
  expect(speech).toHaveLength(3);
});

test("choosing a voice after the next part is ready prepares it once more with that voice", async ({
  page,
}) => {
  const { speech } = await enter(page);
  await startReading(page);
  await expect(badge(page, 2)).toHaveAccessibleName(/已備妥$/);

  await pickVoices(page, ["Puck"]);
  await expect.poll(settled(speech)).toEqual(["done", "done", "done"]);
  expect(speech.at(-1)).toMatchObject({ part: 2, purpose: "prefetch", voice: "Puck" });
  await expect(badge(page, 2)).toHaveAccessibleName(/已備妥$/);
  // The part that is playing is never synthesized again.
  expect(speech.filter((entry) => entry.part === 1)).toHaveLength(1);
});

test("three quick voice changes leave a single live preload, for the last voice", async ({
  page,
}) => {
  const { speech, hold, release } = await enter(page);
  hold();
  await startReading(page);
  await expect.poll(() => prefetches(speech).length).toBe(1);

  await pickVoices(page, ["Puck", "Zephyr", "Charon"]);
  await expect.poll(settled(speech)).toEqual(["done", "aborted", "aborted", "aborted", "open"]);
  expect(prefetches(speech).map((entry) => [entry.part, entry.voice])).toEqual([
    [2, undefined],
    [2, "Puck"],
    [2, "Zephyr"],
    [2, "Charon"],
  ]);
  release();
  await expect(badge(page, 2)).toHaveAccessibleName(/已備妥$/);
  expect(speech).toHaveLength(5);
});

test("rate changes keep the preload in flight instead of synthesizing it again", async ({
  page,
}) => {
  const { speech, hold, release } = await enter(page);
  hold();
  await startReading(page);
  await expect.poll(() => prefetches(speech).length).toBe(1);

  await pickRates(page, ["1.25", "1.5", "0.75"]);
  await expect(badge(page, 2)).toHaveAccessibleName(/準備中$/);
  expect(settled(speech)()).toEqual(["done", "open"]);
  release();
  await expect(badge(page, 2)).toHaveAccessibleName(/已備妥$/);
  expect(settled(speech)()).toEqual(["done", "done"]);
  await expect(reading(page)).toHaveAttribute("data-phase", "playing");
});

test("a voice chosen while paused cancels the old preload and waits for playback", async ({
  page,
}) => {
  const { speech, hold, release } = await enter(page);
  hold();
  await startReading(page);
  await expect.poll(() => prefetches(speech).length).toBe(1);
  await page.locator(".playback-primary").click();
  await expect(reading(page)).toHaveAttribute("data-phase", "paused");

  await pickVoices(page, ["Puck"]);
  await expect.poll(settled(speech)).toEqual(["done", "aborted"]);
  await expect(badge(page, 2)).toHaveAccessibleName(/尚未準備$/);

  release();
  await page.locator(".playback-primary").click();
  await expect(reading(page)).toHaveAttribute("data-phase", "playing");
  await expect(badge(page, 2)).toHaveAccessibleName(/已備妥$/);
  expect(speech.slice(2)).toMatchObject([{ part: 2, purpose: "prefetch", voice: "Puck" }]);
  expect(speech).toHaveLength(3);
});

test("a voice chosen on the last part prepares nothing", async ({ page }) => {
  const { speech } = await enter(page);
  await startReading(page);
  await page.getByRole("button", { name: "下一段", exact: true }).click();
  await page.locator(".playback-primary").click();
  await expect(reading(page)).toHaveAttribute("data-phase", "playing");
  // The prepared last part plays from the cache.
  const before = speech.length;
  expect(speech.map((entry) => [entry.part, entry.purpose])).toEqual([
    [1, "playback"],
    [2, "prefetch"],
  ]);

  await pickVoices(page, ["Puck"]);
  await pickRates(page, ["1.25"]);
  await expect(reading(page)).toHaveAttribute("data-phase", "playing");
  expect(speech).toHaveLength(before);
  await expect(settingsSheet(page)).toBeHidden();
  await expect(voicePicker(page)).toBeHidden();
});

test("review and settings previews synthesize only when asked, not when the voice changes", async ({
  page,
}) => {
  const { speech } = await enter(page);
  await recognize(page);
  await moreEditing(page);
  await page.getByRole("button", { name: "產生試聽" }).first().click();
  await expect(page.getByLabel("段落試聽").getByRole("slider")).toBeEnabled();
  const sheet = await openSettings(page);
  await sheet.getByRole("button", { name: "試聽這個聲音" }).click();
  await expect(sheet.getByLabel("聲音試聽", { exact: true }).getByRole("slider")).toBeEnabled();
  expect(speech).toMatchObject([
    { part: 1, purpose: "preview", voice: undefined },
    { part: "sample", purpose: "preview", voice: "Kore" },
  ]);

  await pickVoices(page, ["Puck", "Zephyr", "Charon"]);
  await pickRates(page, ["1.5"]);
  await expect(page.getByRole("button", { name: "產生試聽" }).first()).toBeEnabled();
  expect(speech).toHaveLength(2);
});
