import { expect, type Page, test } from "@playwright/test";
import { mockAudio } from "./audio-fixture";
import { mockSignedInApi, recognize } from "./fixtures";

const phase = (page: Page, value: string) =>
  expect(page.locator(".playback")).toHaveAttribute("data-phase", value);

// Runs on WebKit too: a failed stream once left the retry stuck short of playing there.
test("a failed stream retries into one PCM playback without another synthesis", async ({
  page,
}) => {
  await mockSignedInApi(page);
  await mockAudio(page);
  // Counted without a route of its own, which would delay responses and hide the race.
  const requests: string[] = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  await page.goto("/");
  await recognize(page);
  await page.getByRole("button", { name: /^進入朗讀/ }).click();
  await phase(page, "idle");

  await page.route("**/api/tts-stream", (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: "TTS_UNAVAILABLE", message: "Try again", requestId: "req-503" } },
    }),
  );
  await page.locator(".playback-primary").click();
  await phase(page, "error");
  await expect(page.locator(".playback-primary")).toHaveText("重試本段");
  expect(await page.evaluate(() => window.audioTest.outputCount())).toBe(0);

  await page.unroute("**/api/tts-stream");
  await page.locator(".playback-primary").click();
  await phase(page, "playing");
  expect(await page.evaluate(() => window.audioTest.outputCount())).toBe(1);
  expect(requests.filter((path) => path === "/api/tts-stream")).toHaveLength(2);
  // The fixture keeps every source to itself: Linux WebKit could hang swapping a native one.
  expect(await page.evaluate(() => window.audioTest.audio.networkState)).toBe(0);
  await page.evaluate(() => window.audioTest.finish());
  await phase(page, "waiting");
  expect(await page.evaluate(() => window.audioTest.outputCount())).toBe(0);
  // Ending plays nothing again; the next part is prepared as a WAV, not streamed.
  expect(requests.filter((path) => path === "/api/tts-stream")).toHaveLength(2);
});
