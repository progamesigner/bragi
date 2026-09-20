import { describe, expect, it } from "vitest";
import { pcmDurationMs, pcmToWav } from "./wav";

describe("WAV audio", () => {
  it("wraps raw PCM bytes and reports their duration", () => {
    const pcm = new Uint8Array(48_000);
    const wav = pcmToWav(pcm);
    const view = new DataView(wav.buffer);
    expect(wav.byteLength).toBe(48_044);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(48_000);
    expect(pcmDurationMs(pcm.byteLength)).toBe(1000);
  });

  it("rejects incomplete PCM samples", () => {
    expect(() => pcmToWav(new Uint8Array(3))).toThrow("complete samples");
  });
});
