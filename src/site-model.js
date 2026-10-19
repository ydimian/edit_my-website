/**
 * site-model.js — the portfolio as editor data, and applying a save.
 *
 * Reads the site's files (pages, photo library, theme) into one JSON model
 * for the editor UI, and turns an editor "save" back into updated files.
 * Everything the browser sends is validated here before it can touch a file.
 */
import { scanRegions, readRegion, applyEdits } from "./html-regions.js";
import { buildThemeCss, readThemeChoices, readDarkDefaults, readLightDefaults, THEME_TOKENS } from "../public/shared/theme.js";
import { deriveLight, isHex } from "../public/shared/palette.js";

export const PAGES = ["index.html", "photography.html"];
export const PHOTO_DATA = "assets/js/data/photos.data.js";
export const THEME_CSS = "assets/css/theme.css";
export const BASE_CSS = "assets/css/base.css";
export const READ_FILES = [...PAGES, PHOTO_DATA, THEME_CSS, BASE_CSS];

const PHOTO_FILE = /^assets\/photos\/([a-z0-9][a-z0-9-]{0,63})(-900)?\.webp$/;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_TEXT = 20000;

/* ---------- photo library file ---------- */

export function parsePhotoData(source) {
  const grab = (name) => {
    const m = source.match(new RegExp(`export const ${name} = ([\\s\\S]*?);\\s*(?=export const|$)`));
    if (!m) throw new Error(`${PHOTO_DATA}: could not find ${name}`);
    return JSON.parse(m[1]);
  };
  return { categories: grab("PHOTO_CATEGORIES"), items: grab("PHOTOS") };
}

export function serializePhotoData(previousSource, { categories, items }) {
  const header = previousSource.slice(0, previousSource.indexOf("export const PHOTO_CATEGORIES"));
  return `${header}export const PHOTO_CATEGORIES = ${JSON.stringify(categories, null, 2)};\n\nexport const PHOTOS = ${JSON.stringify(items, null, 2)};\n`;
}

/* ---------- reading ---------- */

/** files: { path: text } -> the editor model. */
export function readModel(files) {
  const fields = new Map();
  const images = [];
  for (const page of PAGES) {
    const html = files[page];
    for (const region of scanRegions(html)) {
      if (region.marker === "data-edit") {
        const existing = fields.get(region.key);
        if (existing) { existing.pages.push(page); continue; } // shared (e.g. footer): same value on every page
        const { value, color } = readRegion(region, html);
        fields.set(region.key, { key: region.key, kind: region.kind, value, color, pages: [page] });
      } else if (region.marker === "data-edit-img") {
        images.push({ slot: region.key, page, ...readRegion(region, html) });
      }
    }
  }
  const photos = parsePhotoData(files[PHOTO_DATA]);
  return {
    fields: [...fields.values()],
    images,
    photos,
    theme: {
      tokens: THEME_TOKENS,
      defaults: readDarkDefaults(files[BASE_CSS]),
      lightDefaults: readLightDefaults(files[BASE_CSS]),
      choices: readThemeChoices(files[THEME_CSS]),
    },
  };
}

/* ---------- validation ---------- */

class BadRequest extends Error { constructor(m) { super(m); this.status = 400; } }
const fail = (m) => { throw new BadRequest(m); };
const str = (v, max = MAX_TEXT) => (typeof v === "string" && v.length <= max ? v : fail("Text is missing or too long"));

function cleanColor(color) {
  if (color == null) return null;
  if (!isHex(color.dark)) fail("Colours must be hex values like #ef6a3f");
  return { dark: color.dark.toLowerCase(), light: deriveLight("text", color.dark) }; // light is always derived server-side
}

function cleanFieldEdits(edits, model) {
  const known = new Map(model.fields.map((f) => [f.key, f]));
  const out = new Map();
  for (const [key, edit] of Object.entries(edits || {})) {
    const field = known.get(key) || fail(`Unknown field: ${key}`);
    const clean = {};
    if ("value" in edit) {
      if (field.kind === "list") {
        if (!Array.isArray(edit.value) || edit.value.length > 50) fail(`${key}: a list is expected`);
        clean.value = edit.value.map((v) => str(v, 2000));
      } else {
        clean.value = str(edit.value);
      }
    }
    if ("color" in edit) clean.color = cleanColor(edit.color);
    out.set(key, { clean, pages: field.pages });
  }
  return out;
}

function cleanPhoto(p, categoryIds) {
  if (!ID.test(p.id || "")) fail(`Invalid photo id: ${p.id}`);
  if (!Array.isArray(p.ratio) || p.ratio.length !== 2 || !p.ratio.every((n) => Number.isFinite(n) && n > 0)) fail(`${p.id}: invalid ratio`);
  if (!categoryIds.has(p.category)) fail(`${p.id}: unknown category ${p.category}`);
  const e = p.exif || {};
  const photo = {
    id: p.id,
    ratio: p.ratio.map(Number),
    color: isHex(p.color) ? p.color.toLowerCase() : "#222222",
    ...(p.featured ? { featured: true } : {}),
    title: str(p.title ?? "", 200),
    location: str(p.location ?? "", 200),
    ...(p.country ? { country: str(p.country, 100) } : {}),
    category: p.category,
    exif: Object.fromEntries(["camera", "lens", "focal", "aperture", "shutter", "iso"].map((k) => [k, str(String(e[k] ?? ""), 100)])),
  };
  if (p.estimated) photo.estimated = true;
  return photo;
}

function cleanPhotos(photos) {
  if (!photos) return null;
  if (!Array.isArray(photos.categories) || !Array.isArray(photos.items)) fail("Photos: categories and items are required");
  const categories = photos.categories.map((c) => {
    if (!ID.test(c.id || "")) fail(`Invalid category id: ${c.id}`);
    return { id: c.id, label: str(c.label, 60) };
  });
  const categoryIds = new Set(categories.map((c) => c.id));
  if (categoryIds.size !== categories.length) fail("Duplicate category");
  const items = photos.items.map((p) => cleanPhoto(p, categoryIds));
  if (new Set(items.map((p) => p.id)).size !== items.length) fail("Two photos have the same id");
  return { categories, items };
}

function cleanImages(images, model) {
  const slots = new Set(model.images.map((i) => i.slot));
  const out = new Map();
  for (const [slot, v] of Object.entries(images || {})) {
    if (!slots.has(slot)) fail(`Unknown image slot: ${slot}`);
    if (!PHOTO_FILE.test(v.src || "")) fail(`${slot}: image must be a file in assets/photos/`);
    const srcset = String(v.srcset || "");
    for (const part of srcset.split(",").map((s) => s.trim()).filter(Boolean)) {
      if (!PHOTO_FILE.test(part.split(/\s+/)[0])) fail(`${slot}: invalid srcset`);
    }
    out.set(slot, {
      src: v.src, srcset: srcset || null,
      width: Math.round(Number(v.width)) || fail(`${slot}: width required`),
      height: Math.round(Number(v.height)) || fail(`${slot}: height required`),
      alt: str(v.alt ?? "", 300),
      photoId: v.photoId && ID.test(v.photoId) ? v.photoId : null,
      color: isHex(v.color) ? v.color.toLowerCase() : null,
    });
  }
  return out;
}

export function cleanUploads(uploads) {
  const out = [];
  for (const u of uploads || []) {
    if (!PHOTO_FILE.test(u.path || "")) fail(`Uploads must be photos in assets/photos/ (got ${u.path})`);
    if (!/^[0-9a-f]{40}$/.test(u.sha || "")) fail(`${u.path}: upload it first (POST /api/upload)`);
    out.push({ path: u.path, sha: u.sha });
  }
  return out;
}

/* ---------- applying a save ---------- */

/**
 * files: current { path: text }, change: what the editor sends.
 * Returns { changed: { path: text }, deletes: [path] } (uploads are handled by the caller).
 */
export function applyChange(files, change) {
  const model = readModel(files);
  const edits = cleanFieldEdits(change.fields, model);
  const images = cleanImages(change.images, model);
  const photos = cleanPhotos(change.photos);
  const uploads = cleanUploads(change.uploads);

  const changed = {};
  for (const page of PAGES) {
    const pageEdits = new Map([...edits].filter(([, e]) => e.pages.includes(page)).map(([k, e]) => [k, e.clean]));
    const out = applyEdits(files[page], { edits: pageEdits, images });
    if (out !== files[page]) changed[page] = out;
  }

  if (photos) {
    const out = serializePhotoData(files[PHOTO_DATA], photos);
    if (out !== files[PHOTO_DATA]) changed[PHOTO_DATA] = out;
  }

  if (change.theme) {
    const choices = {};
    for (const [id, v] of Object.entries(change.theme.choices || {})) {
      if (!THEME_TOKENS.some((t) => t.id === id)) fail(`Unknown colour: ${id}`);
      if (!isHex(v)) fail(`${id}: colours must be hex values`);
      choices[id] = v.toLowerCase();
    }
    const out = buildThemeCss(choices);
    if (out !== files[THEME_CSS]) changed[THEME_CSS] = out;
  }

  // Photos removed from the library: delete their files unless still used somewhere
  const deletes = [];
  if (photos) {
    const before = parsePhotoData(files[PHOTO_DATA]).items.map((p) => p.id);
    const kept = new Set(photos.items.map((p) => p.id));
    const pages = PAGES.map((p) => changed[p] ?? files[p]).join("\n");
    for (const id of before.filter((id) => !kept.has(id))) {
      for (const path of [`assets/photos/${id}.webp`, `assets/photos/${id}-900.webp`]) {
        if (!pages.includes(path) && !uploads.some((u) => u.path === path)) deletes.push(path);
      }
    }
  }

  // Every image file the new pages / library point at must exist (already, or uploaded now)
  const required = new Set();
  for (const [, img] of images) {
    required.add(img.src);
    for (const part of String(img.srcset || "").split(",").map((s) => s.trim().split(/\s+/)[0]).filter(Boolean)) required.add(part);
  }
  if (photos) {
    const before = new Set(parsePhotoData(files[PHOTO_DATA]).items.map((p) => p.id));
    for (const p of photos.items.filter((p) => !before.has(p.id))) {
      required.add(`assets/photos/${p.id}.webp`);
      required.add(`assets/photos/${p.id}-900.webp`);
    }
  }
  return { changed, deletes, uploads, required: [...required] };
}

export { BadRequest };
