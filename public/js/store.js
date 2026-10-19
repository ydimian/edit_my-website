/**
 * store.js — what's loaded from the draft, and what you've changed since.
 *
 * Only differences are kept: a field edit that's typed back to its saved
 * value disappears, so "unsaved changes" is always accurate. Panels listen
 * for "change" events; the preview listens too, to show edits live.
 */
const listeners = new Set();
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export const store = {
  loaded: null,        // { draftSha, liveSha, changedFiles, model }
  fields: new Map(),   // key -> field (from the draft)
  edits: new Map(),    // key -> { value?, color? }   unsaved differences
  images: new Map(),   // slot -> new image value      unsaved
  photos: null,        // working copy of { categories, items }, or null if untouched
  theme: null,         // working colour choices, or null if untouched
  uploads: new Map(),  // "assets/photos/x.webp" -> Blob  (new files, unsaved)
  uploaded: new Map(), // path -> blob sha, once sent with /api/upload
  objectUrls: new Map(), // path -> blob: URL, to show unsaved images

  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit(detail) { for (const fn of listeners) fn(detail); },

  setLoaded(data) {
    for (const url of this.objectUrls.values()) URL.revokeObjectURL(url);
    this.loaded = data;
    this.fields = new Map(data.model.fields.map((f) => [f.key, f]));
    this.edits.clear();
    this.images.clear();
    this.photos = null;
    this.theme = null;
    this.uploads.clear();
    this.uploaded.clear();
    this.objectUrls.clear();
    this.emit({ type: "loaded" });
  },

  /* ---------- text fields ---------- */
  value(key) {
    const e = this.edits.get(key);
    return e && "value" in e ? e.value : this.fields.get(key)?.value;
  },
  color(key) {
    const e = this.edits.get(key);
    return e && "color" in e ? e.color : this.fields.get(key)?.color ?? null;
  },
  setField(key, patch) {
    const base = this.fields.get(key);
    const next = { ...(this.edits.get(key) || {}), ...patch };
    if ("value" in next && same(next.value, base.value)) delete next.value;
    if ("color" in next && same(next.color, base.color)) delete next.color;
    if (Object.keys(next).length) this.edits.set(key, next); else this.edits.delete(key);
    this.emit({ type: "field", key });
  },
  revertField(key) { this.edits.delete(key); this.emit({ type: "field", key }); },

  /* ---------- page images ---------- */
  image(slot) {
    return this.images.get(slot) || this.loaded.model.images.find((i) => i.slot === slot)?.value;
  },
  setImage(slot, value) { this.images.set(slot, value); this.emit({ type: "image", slot }); },

  /* ---------- photo library ---------- */
  library() { return this.photos || this.loaded.model.photos; },
  editPhotos(mutator) {
    const next = clone(this.library());
    mutator(next);
    this.photos = same(next, this.loaded.model.photos) ? null : next;
    this.emit({ type: "photos" });
  },

  /* ---------- colours ---------- */
  themeChoices() { return this.theme || this.loaded.model.theme.choices; },
  setThemeChoice(id, hex) {
    const next = { ...this.themeChoices() };
    if (hex == null || hex.toLowerCase() === this.loaded.model.theme.defaults[id]) delete next[id]; else next[id] = hex.toLowerCase();
    this.theme = same(next, this.loaded.model.theme.choices) ? null : next;
    this.emit({ type: "theme" });
  },
  resetTheme() { this.theme = same({}, this.loaded.model.theme.choices) ? null : {}; this.emit({ type: "theme" }); },

  /* ---------- uploads ---------- */
  addUpload(path, blob) {
    this.uploads.set(path, blob);
    this.objectUrls.set(path, URL.createObjectURL(blob));
  },
  dropUploadsFor(id) {
    for (const path of [...this.uploads.keys()]) {
      if (path === `assets/photos/${id}.webp` || path === `assets/photos/${id}-900.webp`) {
        this.uploads.delete(path);
        this.uploaded.delete(path);
        URL.revokeObjectURL(this.objectUrls.get(path));
        this.objectUrls.delete(path);
      }
    }
  },
  /** URL to show any site image: unsaved upload, or the file in the saved draft. */
  url(path) {
    return this.objectUrls.get(path) || (path ? `/preview/${this.loaded.draftSha}/${path}` : "");
  },

  /* ---------- state ---------- */
  dirtyCount() {
    return this.edits.size + this.images.size + (this.photos ? 1 : 0) + (this.theme ? 1 : 0);
  },
  isDirty() { return this.dirtyCount() > 0; },
  undoAll() {
    for (const url of this.objectUrls.values()) URL.revokeObjectURL(url);
    this.edits.clear(); this.images.clear(); this.photos = null; this.theme = null; this.uploads.clear(); this.uploaded.clear(); this.objectUrls.clear();
    this.emit({ type: "loaded" });
  },

  /** New files that the pages or library still use (uploads removed again are skipped). */
  usedUploads() {
    const usedPaths = new Set();
    for (const img of this.images.values()) {
      usedPaths.add(img.src);
      for (const part of String(img.srcset || "").split(",")) usedPaths.add(part.trim().split(/\s+/)[0]);
    }
    for (const p of this.library().items) { usedPaths.add(`assets/photos/${p.id}.webp`); usedPaths.add(`assets/photos/${p.id}-900.webp`); }
    return [...this.uploads].filter(([path]) => usedPaths.has(path)).map(([path, blob]) => ({ path, blob }));
  },

  /** Send new files one at a time (each becomes a blob in the repo); onProgress(done, total). */
  async sendUploads(upload, onProgress = () => {}) {
    const todo = this.usedUploads().filter((u) => !this.uploaded.has(u.path));
    for (const [i, u] of todo.entries()) {
      onProgress(i, todo.length);
      const { sha } = await upload(await blobToBase64(u.blob));
      this.uploaded.set(u.path, sha);
    }
  },

  /** The body for POST /api/save (call sendUploads first). */
  buildSave() {
    const fields = Object.fromEntries(this.edits);
    const images = Object.fromEntries(this.images);
    const uploads = this.usedUploads().map(({ path }) => {
      if (!this.uploaded.has(path)) throw new Error(`${path} hasn't been uploaded yet`);
      return { path, sha: this.uploaded.get(path) };
    });
    return {
      baseSha: this.loaded.draftSha,
      change: {
        fields,
        images,
        ...(this.photos ? { photos: this.photos } : {}),
        ...(this.theme ? { theme: { choices: this.theme } } : {}),
        uploads,
      },
    };
  },
};

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
