import { t } from "./i18n";

export const MAX_SOURCE_BYTES = 25_000_000;
export const MAX_UPLOAD_BYTES = 4_000_000;
export const MAX_IMAGE_DIMENSION = 2400;

const ACCEPTED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
const HEIF_TYPES = new Set(["image/heic", "image/heif"]);
const EXTENSION_TYPES: Record<string, string> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

export type PreparedImage = {
  file: File;
  width?: number;
  height?: number;
  transformed: boolean;
  warning?: string;
};

export function targetDimensions(
  width: number,
  height: number,
  maxDimension = MAX_IMAGE_DIMENSION,
): { width: number; height: number } {
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function validateSourceImage(file: File): void {
  if (!ACCEPTED_TYPES.has(file.type)) throw new Error(t("image.unsupportedType"));
  if (file.size <= 0) throw new Error(t("image.empty"));
  if (file.size > MAX_SOURCE_BYTES) throw new Error(t("image.sourceTooLarge"));
}

export function normalizeImageType(file: File): File {
  if (file.type || !file.name.includes(".")) return file;
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  const type = extension ? EXTENSION_TYPES[extension] : undefined;
  return type ? new File([file], file.name, { type, lastModified: file.lastModified }) : file;
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(t("image.compressFailed")))),
      "image/jpeg",
      quality,
    );
  });
}

async function encodeWithinLimit(canvas: HTMLCanvasElement): Promise<Blob | undefined> {
  for (const quality of [0.9, 0.82, 0.74, 0.66, 0.58]) {
    const blob = await canvasBlob(canvas, quality);
    if (blob.size <= MAX_UPLOAD_BYTES) return blob;
  }
  return undefined;
}

function jpegName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "") || "bragi-capture";
  return `${base}.jpg`;
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  const source = normalizeImageType(file);
  validateSourceImage(source);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source, {
      imageOrientation: "from-image",
      premultiplyAlpha: "default",
      colorSpaceConversion: "default",
    });
  } catch {
    if (HEIF_TYPES.has(source.type) && source.size <= MAX_UPLOAD_BYTES) {
      return {
        file: source,
        transformed: false,
        warning: t("image.heicPreviewWarning"),
      };
    }
    if (HEIF_TYPES.has(source.type)) throw new Error(t("image.heicTooLarge"));
    throw new Error(t("image.unreadable"));
  }

  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error(t("image.unprocessable"));
    let dimensions = targetDimensions(bitmap.width, bitmap.height);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await encodeWithinLimit(canvas);
      if (blob)
        return {
          file: new File([blob], jpegName(source.name), {
            type: "image/jpeg",
            lastModified: Date.now(),
          }),
          width: canvas.width,
          height: canvas.height,
          transformed: true,
        };
      dimensions = targetDimensions(
        dimensions.width,
        dimensions.height,
        Math.max(dimensions.width, dimensions.height) * 0.8,
      );
    }
    throw new Error(t("image.stillTooLarge"));
  } finally {
    bitmap.close();
  }
}
