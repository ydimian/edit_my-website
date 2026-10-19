/**
 * exif.js — read camera settings from a JPEG (no library).
 *
 * Only the few tags shown in the gallery are read: camera make/model, lens,
 * focal length, aperture, shutter speed and ISO. Location (GPS) is never
 * read, and re-encoding the photo for the web drops all of this metadata
 * from the published file anyway.
 */
const TAGS = {
  0x010f: "make", 0x0110: "model", 0x8769: "exifPointer",
  0x829a: "exposureTime", 0x829d: "fNumber", 0x8827: "iso", 0x920a: "focalLength", 0xa434: "lensModel",
};

export async function readExif(file) {
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    const view = new DataView(buf);
    if (view.getUint16(0) !== 0xffd8) return null; // not a JPEG
    let offset = 2;
    while (offset + 4 < view.byteLength) {
      const marker = view.getUint16(offset);
      const size = view.getUint16(offset + 2);
      if (marker === 0xffe1 && view.getUint32(offset + 4) === 0x45786966) return format(parseTiff(view, offset + 10));
      if ((marker & 0xff00) !== 0xff00) break;
      offset += 2 + size;
    }
  } catch { /* unreadable: just skip */ }
  return null;
}

function parseTiff(view, start) {
  const little = view.getUint16(start) === 0x4949;
  const u16 = (o) => view.getUint16(start + o, little);
  const u32 = (o) => view.getUint32(start + o, little);
  const out = {};

  const readIfd = (ifdOffset) => {
    const count = u16(ifdOffset);
    for (let i = 0; i < count; i++) {
      const e = ifdOffset + 2 + i * 12;
      const name = TAGS[u16(e)];
      if (!name) continue;
      const type = u16(e + 2), n = u32(e + 4), valueOffset = e + 8;
      const at = (type === 2 && n > 4) || type === 5 ? u32(valueOffset) : valueOffset;
      if (type === 2) out[name] = ascii(view, start + at, n);
      else if (type === 3) out[name] = u16(at);
      else if (type === 4) out[name] = u32(at);
      else if (type === 5) out[name] = u32(at) / (u32(at + 4) || 1);
    }
  };
  readIfd(u32(4));
  if (out.exifPointer) readIfd(out.exifPointer);
  return out;
}

function ascii(view, offset, n) {
  let s = "";
  for (let i = 0; i < n; i++) { const c = view.getUint8(offset + i); if (!c) break; s += String.fromCharCode(c); }
  return s.trim();
}

const titleCase = (s) => (s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s);

/** Raw tags -> the strings shown in the gallery ("1/250s", "f/4", …). */
function format(t) {
  const make = titleCase(t.make || "");
  const model = (t.model || "").replace(new RegExp(`^${t.make || "\\b"}\\s*`, "i"), "");
  return {
    camera: [make, model].filter(Boolean).join(" "),
    lens: t.lensModel || "",
    focal: t.focalLength ? `${Math.round(t.focalLength)}mm` : "",
    aperture: t.fNumber ? `f/${+t.fNumber.toFixed(1)}` : "",
    shutter: t.exposureTime ? (t.exposureTime >= 0.3 ? `${+t.exposureTime.toFixed(1)}s` : `1/${Math.round(1 / t.exposureTime)}s`) : "",
    iso: t.iso ? String(t.iso) : "",
  };
}
