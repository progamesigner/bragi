import { describe, expect, it } from "vitest";
import { translate } from "./i18n";
import { DEFAULT_VOICE, filterVoices, VOICE_CATALOG, voiceTrait, voiceTraits } from "./voices";

const all = VOICE_CATALOG.map(([name]) => name);
const label = (trait: string) => translate("zh-Hant", `voiceTrait.${trait}` as never);

describe("voice picker filtering", () => {
  it("offers all 30 prebuilt voices with Kore as the default", () => {
    expect(all).toHaveLength(30);
    expect(new Set(all).size).toBe(30);
    expect(DEFAULT_VOICE).toBe("Kore");
    expect(filterVoices(all, { query: "" }, label)).toHaveLength(30);
  });

  it("lists every voice alphabetically when nothing is filtered", () => {
    const listed = filterVoices(all, { query: "  " }, label);
    expect(listed).toEqual([...all].sort((a, b) => a.localeCompare(b, "en")));
  });

  it("filters by the official trait only", () => {
    expect(filterVoices(all, { query: "", trait: "firm" }, label)).toEqual([
      "Alnilam",
      "Kore",
      "Orus",
    ]);
    expect(filterVoices(all, { query: "", trait: "warm" }, label)).toEqual(["Sulafat"]);
  });

  it("searches names case-insensitively and translated traits", () => {
    expect(filterVoices(all, { query: "PUC" }, label)).toEqual(["Puck"]);
    expect(filterVoices(all, { query: "明亮" }, label)).toEqual(["Autonoe", "Zephyr"]);
    expect(filterVoices(all, { query: "ach" }, label)).toEqual(["Achernar", "Achird", "Sadachbia"]);
    expect(filterVoices(all, { query: "zzz" }, label)).toEqual([]);
  });

  it("combines the trait filter and the search", () => {
    expect(filterVoices(all, { query: "or", trait: "firm" }, label)).toEqual(["Kore", "Orus"]);
  });

  it("only lists voices the server offers", () => {
    expect(filterVoices(["Kore", "Puck"], { query: "" }, label)).toEqual(["Kore", "Puck"]);
  });

  it("counts each official trait once, in catalog order", () => {
    const traits = voiceTraits(all);
    expect(traits.reduce((sum, entry) => sum + entry.count, 0)).toBe(30);
    expect(traits[0]).toEqual({ trait: "bright", count: 2 });
    expect(traits.find((entry) => entry.trait === "firm")?.count).toBe(3);
    expect(voiceTraits(["Kore", "Puck"])).toEqual([
      { trait: "upbeat", count: 1 },
      { trait: "firm", count: 1 },
    ]);
    expect(voiceTrait("Sulafat")).toBe("warm");
    expect(voiceTrait("Nobody")).toBeUndefined();
  });
});
