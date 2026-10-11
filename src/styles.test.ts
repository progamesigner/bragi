import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value?.trim()]),
  ) as Record<string, string>;
}

const dark = tokens(':root,\n:root[data-theme="dark"]');
const systemLight = tokens("  :root:not([data-theme])");
const light = tokens(':root[data-theme="light"]');

describe("theme tokens", () => {
  it("defines every token as a literal colour, never in terms of itself", () => {
    for (const set of [dark, systemLight, light])
      for (const [name, value] of Object.entries(set))
        expect(value, name).toMatch(/^(#[0-9a-f]{6}|rgb\([\d. /]+\))$/);
  });

  it("gives both themes the same tokens and keeps the OS-light set identical to light", () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
    expect(systemLight).toEqual(light);
  });

  it("uses the design's palette", () => {
    expect(dark).toMatchObject({
      "--bg": "#171512",
      "--surface": "#221e1a",
      "--surface-2": "#1d1a17",
      "--text": "#f3ead8",
      "--text-2": "#c8bbaa",
      "--accent": "#e7a85c",
      "--danger": "#ef9a91",
      "--focus": "#f7c47f",
    });
    expect(light).toMatchObject({
      "--bg": "#f6f1e7",
      "--surface": "#fffcf6",
      "--text": "#2a2119",
      "--accent": "#e09a4a",
      "--accent-text": "#8a4f0e",
      "--danger": "#a8281f",
      "--focus": "#8a4f0e",
    });
  });
});

function declarations(selector: string): Record<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = css
    .slice(css.indexOf("{", start) + 1, css.indexOf("}", start))
    .replace(/\/\*[\s\S]*?\*\//g, "");
  return Object.fromEntries(
    [...body.matchAll(/([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [
      name,
      value?.replace(/\s+/g, " ").trim(),
    ]),
  ) as Record<string, string>;
}

describe("phone playback toast", () => {
  it("takes the clock row's place from the row's own sizes, not a copied offset", () => {
    const layout = declarations(".playback-layout");
    const transport = declarations(".playback-transport");
    const meter = declarations(".playback-meter");
    const toast = declarations(".toast.playback-toast");
    expect(layout).toMatchObject({
      "--playback-transport-border": "1px",
      "--playback-transport-padding": "2px",
      "--playback-meter-height": "44px",
    });
    expect(transport["border-top"]).toBe("var(--playback-transport-border) solid var(--line)");
    expect(transport["padding-top"]).toBe("var(--playback-transport-padding)");
    expect(meter["min-height"]).toBe("var(--playback-meter-height)");
    expect(toast.bottom).toBe(
      "calc( -1 * var(--playback-transport-border) - var(--playback-transport-padding) - var(--playback-meter-height) )",
    );
    expect(toast["min-height"]).toBe("var(--playback-meter-height)");
  });
});
