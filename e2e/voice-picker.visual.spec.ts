import { expect, type Page, test } from "@playwright/test";
import { VOICE_CATALOG } from "../src/lib/voices";
import { mockAudio } from "./audio-fixture";
import { mockSignedInApi, openVoicePicker, voicePicker } from "./fixtures";
import { pageStyle, settle } from "./visual-capture";

// Voice picker baselines, kept apart from visual.spec.ts so the picker's pictures change alone.
const ALL = ["Kore", ...VOICE_CATALOG.map(([name]) => name).filter((name) => name !== "Kore")];

async function snap(page: Page, name: string) {
  await settle(page);
  await expect(page).toHaveScreenshot(`${name}.png`, {
    animations: "disabled",
    stylePath: pageStyle,
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("voice picker", async ({ page }) => {
      await mockSignedInApi(page);
      await mockAudio(page);
      await page.route("**/api/session", (route) =>
        route.fulfill({ json: { authenticated: true, voices: ALL } }),
      );
      await page.addInitScript(() => localStorage.setItem("bragi-voice", "Callirrhoe"));
      await page.goto("/");
      const picker = await openVoicePicker(page);
      await expect(picker.locator("input:checked")).toHaveValue("Callirrhoe");
      await snap(page, `voice-picker-${colorScheme}`);

      // Filtered to one trait, previewing a voice that is not the one in use.
      // The mocked preview would otherwise run on to its end while a slow run catches up.
      await page.evaluate(() => {
        window.audioTest.freezePosition = true;
      });
      await picker.getByLabel("依特質篩選").selectOption({ label: "堅定（3）" });
      await picker.getByRole("button", { name: "試聽 Orus", exact: true }).click();
      await expect(picker.getByRole("button", { name: "停止 Orus", exact: true })).toBeVisible();
      await snap(page, `voice-picker-preview-${colorScheme}`);
      await expect(voicePicker(page)).toBeVisible();
    });
  });
}
