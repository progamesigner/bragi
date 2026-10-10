import { expect, type Page, test } from "@playwright/test";

type Snapshot = {
  phase: string;
  reason?: string;
  transport: string;
  calls: number;
  position: number;
  seekable: boolean;
  owner: string;
  contextTime: number;
  nativeTime: number;
  nativeRate: number;
  activeOutputs: number;
  preservesPitch: boolean;
  preloadReady: boolean;
};
async function read(page: Page): Promise<Snapshot> {
  return JSON.parse(await page.locator("#snapshot").innerText());
}
async function phase(page: Page, value: string) {
  await expect.poll(async () => (await read(page)).phase).toBe(value);
}
for (const path of ["cached", "prefetched", "pcm", "rate"]) {
  test(`one gesture starts ${path} with native clock progress`, async ({ page }, info) => {
    await page.goto("/");
    if (path === "prefetched") {
      await page.locator("#prefetch").click();
      await expect.poll(async () => (await read(page)).preloadReady).toBe(true);
    }
    await page.locator(`#${path}`).click();
    // No protocol evaluation during delayed synthesis: activation must expire naturally.
    await page.waitForTimeout(path === "pcm" || path === "rate" ? 8500 : 700);
    const state = await read(page);
    expect(state.phase).toBe("playing");
    expect(state.calls).toBe(path === "cached" ? 0 : 1);
    expect(state.activeOutputs).toBe(1);
    expect(state.transport).toBe(path === "pcm" ? "pcm" : "wav");
    expect(state.position).toBeGreaterThan(0.1);
    if (path === "rate") {
      expect(state.nativeRate).toBe(1.5);
      expect(state.preservesPitch).toBe(true);
    }
    const events = JSON.parse(await page.locator("#events").innerText());
    if (path === "pcm" || path === "rate")
      expect(
        events.find((entry: { event: string }) => entry.event === "synthesis-ready").active,
      ).toBe(false);
    await info.attach("controller-evidence", {
      body: JSON.stringify({ state, events }),
      contentType: "application/json",
    });
  });
}
for (const path of ["cached", "pcm"])
  test(`native no-gesture policy for ${path}`, async ({ page }, info) => {
    await page.goto(`/?autostart=${path}&delay=20`);
    await page.waitForTimeout(1900); // Frozen native snapshot, before assertions.
    const frozen: Snapshot = JSON.parse(await page.locator("#policy").innerText());
    expect(frozen.phase).toBe("blocked");
    expect(frozen.activeOutputs).toBe(0);
    expect(["not-allowed", "resume-timeout", "suspended"]).toContain(frozen.reason);
    await info.attach("native-policy", {
      body: JSON.stringify(frozen),
      contentType: "application/json",
    });
    await page.locator("#resume").click();
    await phase(page, "playing");
    expect((await read(page)).calls).toBe(frozen.calls);
  });

test("content NotAllowedError recovers retained WAV without TTS", async ({ page }) => {
  await page.goto("/?delay=50");
  await page.locator("#reject").click();
  await page.locator("#rate").click();
  await phase(page, "blocked");
  expect((await read(page)).reason).toBe("not-allowed");
  await page.locator("#resume").click();
  await phase(page, "playing");
  expect((await read(page)).calls).toBe(1);
});

test("resume timeout and late resolution never start buffered PCM", async ({ page }) => {
  await page.goto("/?delay=50");
  await page.locator("#hold").click();
  await page.locator("#pcm").click();
  await page.waitForTimeout(3000);
  expect(await read(page)).toMatchObject({
    phase: "blocked",
    reason: "resume-timeout",
    activeOutputs: 0,
    calls: 1,
  });
  await page.locator("#resume").click();
  await phase(page, "playing");
  expect((await read(page)).calls).toBe(1);
});

test("a failed stream retries into one PCM output", async ({ page }) => {
  await page.goto("/?delay=50");
  await page.locator("#fail").click();
  await page.locator("#pcm").click();
  await phase(page, "error");
  expect(await read(page)).toMatchObject({ calls: 1, activeOutputs: 0 });
  await page.locator("#pcm").click();
  await phase(page, "playing");
  expect(await read(page)).toMatchObject({ transport: "pcm", calls: 2, activeOutputs: 1 });
});

test("PCM EOF enables explicit seek, paused seek keeps silence", async ({ page }) => {
  await page.goto("/?delay=50");
  await page.locator("#pcm").click();
  await phase(page, "playing");
  await expect(page.locator("#seek")).toBeEnabled();
  expect((await read(page)).transport).toBe("pcm");
  await page.locator("#pause").click();
  await phase(page, "paused");
  await page.locator("#seek").focus();
  await page.keyboard.press("End");
  expect(await read(page)).toMatchObject({ phase: "paused", transport: "wav", activeOutputs: 0 });
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  expect((await read(page)).position).toBeCloseTo(0.25, 1);
  await page.locator("#resume").click();
  await phase(page, "playing");
  expect((await read(page)).calls).toBe(1);
});

test("system suspension differs from user pause and explicit resume retains position", async ({
  page,
}) => {
  await page.goto("/?delay=50");
  await page.locator("#pcm").click();
  await phase(page, "playing");
  await page.locator("#interrupt").click();
  await phase(page, "interrupted");
  const before = await read(page);
  expect(before.reason).toBe("suspended");
  await page.locator("#resume").click();
  await phase(page, "playing");
  expect((await read(page)).position).toBeGreaterThanOrEqual(before.position);
  await page.locator("#pause").click();
  expect(await read(page)).toMatchObject({ phase: "paused", reason: "user" });
});

test("owner switch and stop discard late synthesis and preserve one output", async ({ page }) => {
  await page.goto("/?delay=1000");
  await page.locator("#pcm").click();
  await page.locator("#sample").click();
  await phase(page, "playing");
  await page.waitForTimeout(1500);
  expect(await read(page)).toMatchObject({ phase: "playing", owner: "sample", activeOutputs: 1 });
  await page.locator("#stop").click();
  expect(await read(page)).toMatchObject({ phase: "idle", activeOutputs: 0 });
});

test("playing PCM yields immediately to a sample owner", async ({ page }) => {
  await page.goto("/?delay=50");
  await page.locator("#pcm").click();
  await phase(page, "playing");
  await page.locator("#sample").click();
  await phase(page, "playing");
  expect(await read(page)).toMatchObject({ owner: "sample", transport: "wav", activeOutputs: 1 });
  await page.waitForTimeout(1000);
  expect((await read(page)).owner).toBe("sample");
});

test("cached WAV supports keyboard seek and stops at the real end", async ({ page }) => {
  await page.goto("/");
  await page.locator("#cached").click();
  await phase(page, "playing");
  await expect(page.locator("#seek")).toBeEnabled();
  await page.locator("#seek").focus();
  await page.keyboard.press("End");
  expect((await read(page)).position).toBeGreaterThanOrEqual(11);
  await phase(page, "ended");
  expect(await read(page)).toMatchObject({ phase: "ended", calls: 0, activeOutputs: 0 });
});
