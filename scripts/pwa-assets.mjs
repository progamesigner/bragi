/** Icons rendered by build-icons.mjs from the SVG sources in assets/icon/. */
export const ICONS = [
  { source: "icon.svg", output: "icon-192.png", size: 192 },
  { source: "icon.svg", output: "icon-512.png", size: 512 },
  { source: "icon-maskable.svg", output: "icon-maskable-192.png", size: 192 },
  { source: "icon-maskable.svg", output: "icon-maskable-512.png", size: 512 },
  // iOS draws its own rounded mask and ignores transparency, so it gets the full-bleed artwork.
  { source: "icon-maskable.svg", output: "apple-touch-icon.png", size: 180 },
  { source: "icon.svg", output: "favicon-32.png", size: 32 },
  { source: "icon.svg", output: "favicon.svg" },
];

/** Public files the service worker precaches next to the hashed build output. */
export const PRECACHED_PUBLIC_ASSETS = [
  "/offline.html",
  "/manifest.webmanifest",
  ...ICONS.map((icon) => `/${icon.output}`),
];
