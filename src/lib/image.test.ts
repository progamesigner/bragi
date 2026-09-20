import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_IMAGE_DIMENSION,
  MAX_SOURCE_BYTES,
  normalizeImageType,
  prepareImage,
  targetDimensions,
  validateSourceImage,
} from "./image";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("image preparation limits", () => {
  it("keeps small images at their original dimensions", () => {
    expect(targetDimensions(1200, 800)).toEqual({ width: 1200, height: 800 });
  });

  it("scales either orientation within the maximum dimension", () => {
    expect(targetDimensions(4800, 3200)).toEqual({
      width: MAX_IMAGE_DIMENSION,
      height: 1600,
    });
    expect(targetDimensions(3000, 6000)).toEqual({
      width: 1200,
      height: MAX_IMAGE_DIMENSION,
    });
  });

  it("rejects unsupported and oversized sources before decoding", () => {
    expect(() =>
      validateSourceImage(new File(["text"], "card.txt", { type: "text/plain" })),
    ).toThrow("JPEG");
    expect(() =>
      validateSourceImage({
        name: "large.jpg",
        type: "image/jpeg",
        size: MAX_SOURCE_BYTES + 1,
      } as File),
    ).toThrow("25 MB");
  });

  it("recovers missing mobile MIME types from known file extensions", () => {
    const file = new File(["image"], "capture.HEIC");
    expect(normalizeImageType(file).type).toBe("image/heic");
  });

  it("keeps a small HEIC original when the browser cannot decode it", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("unsupported")));
    const file = new File(["image"], "capture.heic", { type: "image/heic" });

    await expect(prepareImage(file)).resolves.toMatchObject({
      file,
      transformed: false,
      warning: expect.stringContaining("HEIC"),
    });
  });
});
