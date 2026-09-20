import { describe, expect, it } from "vitest";
import { createTestWav } from "./wav";

describe("test WAV", () => {
  it("creates deterministic 24 kHz, 16-bit, mono PCM", () => {
    const wav = createTestWav(300);
    const view = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(wav.byteLength).toBe(14_444);
  });
});
