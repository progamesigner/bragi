import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("uses one reading font variable for the script and both review text fields", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  for (const selector of [
    ".playback-script p",
    ".playback-script p.spoken-text",
    ".review-segment textarea",
  ])
    expect(css).toMatch(
      new RegExp(
        `${selector.replaceAll(".", "\\.")} \\{[^}]*font-size: var\\(--reading-font-size\\)`,
      ),
    );
  expect(css).toMatch(/main \{\s*--reading-font-size:/);
  for (const preset of ["large", "largest"])
    expect(css).toContain(`main[data-font-size="${preset}"] {\n  --reading-font-size:`);
});
