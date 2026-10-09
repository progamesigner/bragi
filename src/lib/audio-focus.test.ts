import { describe, expect, it, vi } from "vitest";
import { claimAudio } from "./audio-focus";

describe("audio focus", () => {
  it("pauses the previous source when another one starts", () => {
    const narration = vi.fn();
    const sample = vi.fn();
    claimAudio(narration);
    const claim = claimAudio(sample);
    expect(narration).toHaveBeenCalledOnce();
    expect(sample).not.toHaveBeenCalled();
    claim.release();
    claimAudio(narration);
    expect(sample).not.toHaveBeenCalled();
  });

  it("ignores a release from a source that already lost focus", () => {
    const first = vi.fn();
    const second = vi.fn();
    const old = claimAudio(first);
    claimAudio(second);
    old.release();
    claimAudio(() => {});
    expect(second).toHaveBeenCalledOnce();
  });
});
