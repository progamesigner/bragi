import { afterEach, expect, it, vi } from "vitest";
import { allowedVoices, resolveVoice } from "./voices";

afterEach(() => vi.unstubAllEnvs());

it("uses the server default and permits only configured alternatives", () => {
  vi.stubEnv("GEMINI_TTS_VOICE", "Kore");
  vi.stubEnv("GEMINI_TTS_VOICES", " Puck , Kore , Puck ");
  expect(allowedVoices()).toEqual(["Kore", "Puck"]);
  expect(resolveVoice()).toBe("Kore");
  expect(resolveVoice("Puck")).toBe("Puck");
  expect(() => resolveVoice("arbitrary-client-voice")).toThrow("not allowed");
});
