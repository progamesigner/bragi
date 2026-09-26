import { expect, it } from "vitest";
import { allowedVoices, resolveVoice } from "./voices";

it("offers every prebuilt voice with the default first", () => {
  const voices = allowedVoices();
  expect(voices).toHaveLength(30);
  expect(new Set(voices).size).toBe(30);
  expect(voices[0]).toBe("Kore");
});

it("uses the default voice and rejects voices outside the catalog", () => {
  expect(resolveVoice()).toBe("Kore");
  expect(resolveVoice("Sulafat")).toBe("Sulafat");
  expect(() => resolveVoice("arbitrary-client-voice")).toThrow("not allowed");
});
