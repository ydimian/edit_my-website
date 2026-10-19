/**
 * panels/photos.js — the photo library and the pictures used on the pages.
 *
 *   Page images   the photography header, the print mock-up, the About portrait
 *   Categories    the gallery's filter buttons
 *   Photos        add, reorder (drag), feature on the home page, edit details, delete
 *
 * Photo changes show in the preview after you save the draft (the gallery is
 * built by the site's JavaScript from the saved library).
 */
import { store } from "../store.js";
import { preview } from "../preview.js";
import { h, $, $$, modal, confirmBox, toast } from "../dom.js";
import { processPhoto, makeId, titleFromName, imageValue } from "../lib/image.js";

const root = $("#panel-photos");
let filterCat = "all";
const freshIds = new Set(); // photos added since the last save (highlighted)

const SLOTS = {
  "photography.hero": { name: "Photography · header", hint: "Big picture at the top of the photography page" },
  "photography.print": { name: "Photography · print", hint: "Shown as the framed print" },
  "about.portrait": { name: "Home · About portrait", hint: "Your photo in the About section" },
};

const placeName = (p) => [p.location, p.country].filter(Boolean).join(", ");
const settingsLine = (e = {}) => [e.focal, e.aperture, e.shutter, e.iso && `ISO ${e.iso}`].filter(Boolean).join(" · ");

/** Text fields to fill in when a picture is placed in a slot. */
const SLOT_TEXT = {
  "photography.hero": (p) => ({ "photography.hero.caption": p.location ? `Fig. 01 — ${placeName(p)}` : undefined, "photography.hero.settings": settingsLine(p.exif) || undefined }),
  "photography.print": (p) => ({ "photography.prints.caption": p.title ? [p.title, p.location].filter(Boolean).join(" · ") : undefined }),
  "about.portrait": (p) => ({
    "about.portrait-focal": p.exif?.focal || undefined,
    "about.portrait-exposure": [p.exif?.shutter?.replace(/s$/, ""), p.exif?.aperture, p.exif?.iso && `ISO ${p.exif.iso}`].filter(Boolean).join(" · ") || undefined,
    "about.portrait-caption": p.location ? `Fig. 02 — ${placeName(p)}` : undefined,
  }),
};

export function renderPhotos() {
  const lib = store.library();
  const savedIds = new Set(store.loaded.model.photos.items.map((p) => p.id));
  for (const id of [...freshIds]) if (savedIds.has(id)) freshIds.delete(id);
  const scroll = root.scrollTop;

  root.replaceChildren(
    h("h2", { text: "Photos" }),
    h("p", { class: "lede" }, "Add and arrange your photographs. Changes to the gallery appear in the preview once you save the draft."),

    h("div", { class: "section" }, h("h3", { text: "Page images" })),
    h("div", { class: "slots" }, Object.keys(SLOTS).map(renderSlot)),

    h("div", { class: "section" }, h("h3", { text: "Gallery categories" }),
      h("button", { class: "btn btn--sm", type: "button", onclick: addCategory }, "+ Add category")),
    h("div", { class: "cats" }, lib.categories.map((c) => renderCategory(c, lib))),

    h("div", { class: "section" }, h("h3", { text: `Photos (${lib.items.length})` }),
      h("select", { class: "search", style: { flex: "0 0 auto", minWidth: "0", width: "auto" }, onchange: (e) => { filterCat = e.target.value; renderPhotos(); } },
        h("option", { value: "all", selected: filterCat === "all" }, "All categories"),
        lib.categories.map((c) => h("option", { value: c.id, selected: filterCat === c.id }, c.label)))),
    renderDrop(),
    h("p", { class: "fld__hint", style: { marginTop: "10px" } }, "Drag to reorder (this is the gallery order). ★ = featured on the home page (the first 5 are shown)."),
    renderGrid(lib),
  );
  root.scrollTop = scroll;
}

/* ---------- page images ---------- */

function renderSlot(slot) {
  const img = store.image(slot);
  const changed = store.images.has(slot);
  return h("div", { class: "card slot" },
    h("img", { src: store.url(img?.src), alt: "" }),
    h("div", { class: "slot__name", text: SLOTS[slot].name + (changed ? " · changed" : "") }),
    h("p", { class: "fld__hint", text: SLOTS[slot].hint }),
    h("button", { class: "btn btn--sm", type: "button", onclick: () => pickForSlot(slot) }, "Change…"),
  );
}

async function pickForSlot(slot) {
  const lib = store.library();
  const upload = h("input", { type: "file", accept: "image/*", hidden: true });
  const picked = await modal({
    title: `Choose: ${SLOTS[slot].name}`,
    wide: true,
    body: h("div", {},
      h("div", { class: "toolbar" },
        h("button", { class: "btn btn--sm", type: "button", onclick: () => upload.click() }, "Upload a new image…"),
        h("span", { class: "fld__hint" }, "or pick one of your gallery photos:")),
      upload,
      h("div", { class: "pick-grid" }, lib.items.map((p) => h("button", { type: "button", "data-id": p.id, title: p.title },
        h("img", { src: store.url(`assets/photos/${p.id}-900.webp`), alt: p.title, loading: "lazy" })))),
    ),
    actions: [],
    onOpen: (dlg, close) => {
      dlg.addEventListener("click", (e) => { const b = e.target.closest("[data-id]"); if (b) close({ photo: lib.items.find((p) => p.id === b.dataset.id) }); });
      upload.addEventListener("change", () => upload.files[0] && close({ file: upload.files[0] }));
    },
  });
  if (!picked) return;

  if (picked.photo) {
    const p = picked.photo;
    store.setImage(slot, imageValue({ id: p.id, ratio: p.ratio, alt: `${p.title}${placeName(p) ? ` — ${placeName(p)}` : ""}`, color: p.color, photoId: p.id }));
    fillSlotText(slot, p);
  } else {
    const busy = toast("Preparing image…", "info", 60000);
    try {
      const taken = new Set([...lib.items.map((p) => p.id), ...[...store.uploads.keys()].map((k) => k.split("/").pop().replace(/(-900)?\.webp$/, ""))]);
      const result = await processPhoto(picked.file);
      const id = makeId(picked.file.name, taken);
      store.addUpload(`assets/photos/${id}.webp`, result.full.blob);
      store.addUpload(`assets/photos/${id}-900.webp`, result.thumb.blob);
      store.setImage(slot, imageValue({ id, ratio: result.ratio, alt: titleFromName(picked.file.name), color: result.color }));
      fillSlotText(slot, { exif: result.exif || {} });
    } catch (e) {
      toast(e.message, "error");
    } finally {
      busy.remove();
    }
  }
  preview.image(slot);
  renderPhotos();
}

function fillSlotText(slot, photo) {
  const updates = SLOT_TEXT[slot]?.(photo) || {};
  let n = 0;
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined || !store.fields.has(key)) continue;
    store.setField(key, { value });
    preview.field(key);
    n++;
  }
  if (n) { store.emit({ type: "bulk" }); toast(`Updated ${n} caption${n === 1 ? "" : "s"} to match the photo. You can edit them in Text.`); }
}

/* ---------- categories ---------- */

function renderCategory(cat, lib) {
  const count = lib.items.filter((p) => p.category === cat.id).length;
  return h("div", { class: "cat" },
    h("input", { type: "text", value: cat.label, "aria-label": "Category name", onchange: (e) => {
      const label = e.target.value.trim();
      if (!label) { e.target.value = cat.label; return; }
      store.editPhotos((l) => { l.categories.find((c) => c.id === cat.id).label = label; });
    } }),
    h("span", { class: "cat__count", text: `${count} photo${count === 1 ? "" : "s"}` }),
    h("button", { class: "btn btn--sm btn--danger", type: "button", disabled: count > 0 || lib.categories.length === 1, title: count ? "Move or delete its photos first" : "Delete category",
      onclick: () => store.editPhotos((l) => { l.categories = l.categories.filter((c) => c.id !== cat.id); }) }, "Delete"),
  );
}

async function addCategory() {
  const input = h("input", { type: "text", placeholder: "e.g. Night sky", style: { width: "100%" } });
  const label = await modal({
    title: "New category",
    body: h("label", { class: "field" }, h("span", {}, "Name"), input),
    actions: [{ label: "Cancel", value: null }, { label: "Add", value: () => input.value.trim(), kind: "solid" }],
    onOpen: () => input.focus(),
  });
  if (!label) return;
  store.editPhotos((l) => { l.categories.push({ id: makeId(label, new Set(l.categories.map((c) => c.id))), label }); });
}

/* ---------- adding photos ---------- */

function renderDrop() {
  const input = h("input", { type: "file", accept: "image/*", multiple: true, hidden: true, onchange: () => addFiles([...input.files]) });
  const zone = h("div", { class: "drop" },
    h("strong", {}, "Add photos"), " · drop images here or ",
    h("button", { class: "link-btn", type: "button", onclick: () => input.click() }, "choose files"),
    h("div", { class: "fld__hint", style: { marginTop: "4px" } }, "Resized to 2200 px, converted to WebP, location data removed. Camera settings are read automatically."),
    input,
  );
  zone.addEventListener("dragover", (e) => { if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); zone.classList.add("is-over"); } });
  zone.addEventListener("dragleave", () => zone.classList.remove("is-over"));
  zone.addEventListener("drop", (e) => { e.preventDefault(); zone.classList.remove("is-over"); addFiles([...e.dataTransfer.files]); });
  return zone;
}

async function addFiles(files) {
  const images = files.filter((f) => f.type.startsWith("image/"));
  if (!images.length) return;
  const status = toast(`Preparing ${images.length} photo${images.length === 1 ? "" : "s"}…`, "info", 600000);
  const added = [];
  for (const [i, file] of images.entries()) {
    status.textContent = `Preparing photo ${i + 1} of ${images.length}: ${file.name}`;
    try {
      const r = await processPhoto(file);
      const lib = store.library();
      const id = makeId(file.name, new Set(lib.items.map((p) => p.id)));
      store.addUpload(`assets/photos/${id}.webp`, r.full.blob);
      store.addUpload(`assets/photos/${id}-900.webp`, r.thumb.blob);
      const category = filterCat !== "all" ? filterCat : lib.categories[0].id;
      const exif = { camera: "", lens: "", focal: "", aperture: "", shutter: "", iso: "", ...(r.exif || {}) };
      store.editPhotos((l) => { l.items.unshift({ id, ratio: r.ratio, color: r.color, title: titleFromName(file.name), location: "", category, exif }); });
      freshIds.add(id);
      added.push(id);
    } catch (e) {
      toast(e.message, "error");
    }
  }
  status.remove();
  if (added.length) toast(`Added ${added.length} photo${added.length === 1 ? "" : "s"} at the start of the gallery. Click each one to give it a title and location.`, "ok", 6000);
  renderPhotos();
}

/* ---------- the grid ---------- */

function renderGrid(lib) {
  const featuredOrder = lib.items.filter((p) => p.featured).map((p) => p.id);
  const visible = lib.items.filter((p) => filterCat === "all" || p.category === filterCat);
  if (!visible.length) return h("div", { class: "empty", text: "No photos here yet." });
  const catLabel = Object.fromEntries(lib.categories.map((c) => [c.id, c.label]));
  let dragId = null;

  const grid = h("div", { class: "grid" }, visible.map((p) => {
    const index = lib.items.indexOf(p) + 1;
    const featuredRank = featuredOrder.indexOf(p.id);
    const card = h("div", { class: `ph${freshIds.has(p.id) ? " is-new" : ""}`, draggable: true, "data-id": p.id, tabindex: 0, role: "button", "aria-label": `Edit ${p.title}` },
      h("img", { src: store.url(`assets/photos/${p.id}-900.webp`), alt: "", loading: "lazy", style: { "--c": p.color } }),
      h("span", { class: "ph__n", text: String(index).padStart(2, "0") }),
      h("button", { class: "ph__star", type: "button", "aria-pressed": String(Boolean(p.featured)), title: p.featured ? `Featured on the home page${featuredRank >= 5 ? " (only the first 5 are shown)" : ""}` : "Feature on the home page",
        onclick: (e) => { e.stopPropagation(); store.editPhotos((l) => { const it = l.items.find((x) => x.id === p.id); if (it.featured) delete it.featured; else it.featured = true; }); } }, "★"),
      freshIds.has(p.id) ? h("span", { class: "ph__badge", text: "NEW" }) : null,
      h("div", { class: "ph__body" },
        h("span", { class: "ph__title", text: p.title || "Untitled" }),
        h("span", { class: "ph__meta", text: [catLabel[p.category], placeName(p) || "no location yet"].join(" · ") })),
    );
    card.addEventListener("click", () => editPhoto(p.id));
    card.addEventListener("keydown", (e) => { if (e.key === "Enter") editPhoto(p.id); });
    card.addEventListener("dragstart", (e) => { dragId = p.id; card.classList.add("is-dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", p.id); });
    card.addEventListener("dragend", () => { card.classList.remove("is-dragging"); $$(".ph.is-target", grid).forEach((c) => c.classList.remove("is-target")); });
    card.addEventListener("dragover", (e) => { if (dragId && dragId !== p.id) { e.preventDefault(); card.classList.add("is-target"); } });
    card.addEventListener("dragleave", () => card.classList.remove("is-target"));
    card.addEventListener("drop", (e) => { e.preventDefault(); if (dragId && dragId !== p.id) movePhoto(dragId, p.id); });
    return card;
  }));
  return grid;
}

/** Move photo `id` to where `targetId` is. */
function movePhoto(id, targetId) {
  store.editPhotos((l) => {
    const from = l.items.findIndex((p) => p.id === id);
    const [item] = l.items.splice(from, 1);
    const to = l.items.findIndex((p) => p.id === targetId);
    l.items.splice(from <= to ? to + 1 : to, 0, item);
  });
}

/* ---------- editing one photo ---------- */

async function editPhoto(id) {
  const lib = store.library();
  const p = structuredClone(lib.items.find((x) => x.id === id));
  const input = (label, value, key, full = false) => h("label", { class: `field${full ? " full" : ""}` }, h("span", {}, label), h("input", { type: "text", value: value ?? "", "data-k": key }));
  const position = h("input", { type: "number", min: 1, max: lib.items.length, value: lib.items.findIndex((x) => x.id === id) + 1 });

  const body = h("div", { class: "photo-edit" },
    h("div", {},
      h("img", { src: store.url(`assets/photos/${id}-900.webp`), alt: "" }),
      h("p", { class: "fld__hint", style: { marginTop: "8px" } }, `File: assets/photos/${id}.webp`)),
    h("div", { class: "fields" },
      input("Title", p.title, "title", true),
      input("Location", p.location, "location"),
      input("Country (optional)", p.country, "country"),
      h("label", { class: "field" }, h("span", {}, "Category"),
        h("select", { "data-k": "category" }, lib.categories.map((c) => h("option", { value: c.id, selected: c.id === p.category }, c.label)))),
      h("label", { class: "field" }, h("span", {}, `Position (1–${lib.items.length})`), position),
      h("label", { class: "check full" }, h("input", { type: "checkbox", "data-k": "featured", checked: Boolean(p.featured) }), "Featured on the home page"),
      input("Camera", p.exif?.camera, "exif.camera"),
      input("Lens", p.exif?.lens, "exif.lens"),
      input("Focal length", p.exif?.focal, "exif.focal"),
      input("Aperture", p.exif?.aperture, "exif.aperture"),
      input("Shutter", p.exif?.shutter, "exif.shutter"),
      input("ISO", p.exif?.iso, "exif.iso"),
      h("label", { class: "field" }, h("span", {}, "Colour (placeholder & tag)"), h("input", { type: "color", value: p.color || "#222222", "data-k": "color" })),
    ),
  );

  const result = await modal({
    title: "Photo details",
    wide: true,
    body,
    actions: [{ label: "Delete photo", value: "delete", kind: "danger" }, { label: "Cancel", value: null }, { label: "Done", value: "save", kind: "solid" }],
  });

  if (result === "delete") {
    if (!(await confirmBox("Delete this photo?", `“${p.title}” will be removed from the gallery when you save, and its files deleted.`, "Delete", "danger"))) return;
    store.editPhotos((l) => { l.items = l.items.filter((x) => x.id !== id); });
    store.dropUploadsFor(id);
    freshIds.delete(id);
    renderPhotos();
    return;
  }
  if (result !== "save") return;

  for (const el of $$("[data-k]", body)) {
    const key = el.dataset.k;
    const value = el.type === "checkbox" ? el.checked : el.value.trim();
    if (key.startsWith("exif.")) (p.exif ||= {})[key.slice(5)] = value;
    else if (key === "featured") { if (value) p.featured = true; else delete p.featured; }
    else if (key === "country") { if (value) p.country = value; else delete p.country; }
    else p[key] = value;
  }
  const newIndex = Math.max(1, Math.min(lib.items.length, Number(position.value) || 1)) - 1;
  store.editPhotos((l) => {
    const i = l.items.findIndex((x) => x.id === id);
    l.items.splice(i, 1);
    l.items.splice(newIndex, 0, p);
  });
  renderPhotos();
}
