import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("keeps the normal editor size and scales secondary speech text below narration", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  expect(css).toMatch(/\.app \{\s*--reading-font-size:/);
  expect(css).toMatch(/\.playback-script p \{[^}]*font-size: var\(--reading-font-size\)/);
  expect(css).toMatch(/\.review-segment textarea \{\s*font-size: inherit;/);
  expect(css).toMatch(
    /\.playback-script p\.spoken-text \{[^}]*font-size: calc\(var\(--reading-font-size\) \* 2 \/ 3\)/,
  );
  expect(css).toContain('[data-font-size="large"] .review-segment textarea,');
  expect(css).toContain(
    '[data-font-size="largest"] .review-segment textarea {\n  font-size: var(--reading-font-size);',
  );
  for (const preset of ["large", "largest"])
    expect(css).toContain(`[data-font-size="${preset}"] {\n  --reading-font-size:`);
});
