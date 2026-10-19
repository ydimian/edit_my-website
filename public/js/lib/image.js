/**
 * image.js — prepare a photo for the web, entirely in the browser.
 *
 * From the original file it makes the two WebP versions the site uses
 * (2200px and 900px on the long edge), measures the dominant colour, and
 * reads the camera settings. Re-encoding through a canvas also strips all
 * metadata, including any GPS location, from the files that get published.
 */
import { readExif } from "./exif.js";

export const FULL = 2200;
export const THUMB = 900;

export async function processPhoto(file) {
  if (!file.type.startsWith("image/")) throw new Error(`${file.name} isn't an image`);
  const exif = await readExif(file);
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(`${file.name}: this browser can't read this image type (use JPEG, PNG or WebP)`);
  }
  const full = await encode(bitmap, FULL, 0.8);
  const thumb = await encode(bitmap, THUMB, 0.76);
  const color = dominantColor(bitmap);
  bitmap.close?.();
  return { full, thumb, color, exif, ratio: [full.width, full.height] };
}

async function encode(bitmap, longEdge, quality) {
  const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  const blob = await canvas.convertToBlob({ type: "image/webp", quality });
  if (blob.type !== "image/webp") throw new Error("This browser can't make WebP images. Use Chrome, Edge or Firefox.");
  return { blob, width, height };
}

function dominantColor(bitmap) {
  const canvas = new OffscreenCanvas(24, 24);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, 24, 24);
  const px = ctx.getImageData(0, 0, 24, 24).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; }
  const n = px.length / 4;
  return `#${[r, g, b].map((v) => Math.round(v / n).toString(16).padStart(2, "0")).join("")}`;
}

/** "IMG_2041 copy.JPG" -> "img-2041-copy" (unique among `taken`). */
export function makeId(name, taken) {
  const base = name.replace(/\.[^.]+$/, "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "photo";
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
}

/** "mount_rainier-3" -> "Mount Rainier 3" */
export const titleFromName = (name) => name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().replace(/\b\w/g, (c) => c.toUpperCase());

/** The <img> value for a picture stored as <id>.webp + <id>-900.webp. */
export function imageValue({ id, ratio, title, alt, color, photoId }) {
  const [w, h] = ratio;
  // ratio is either just an aspect ([3, 2]) or real pixel sizes; files are at most `edge` px on the long side
  const dims = (edge) => {
    const long = Math.max(w, h);
    const s = long < 100 ? edge / long : Math.min(1, edge / long);
    return [Math.round(w * s), Math.round(h * s)];
  };
  const [fw, fh] = dims(FULL);
  const [tw] = dims(THUMB);
  return {
    src: `assets/photos/${id}.webp`,
    srcset: `assets/photos/${id}-900.webp ${tw}w, assets/photos/${id}.webp ${fw}w`,
    width: fw, height: fh,
    alt: alt ?? title ?? "",
    color, photoId: photoId ?? null,
  };
}
