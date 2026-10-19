/**
 * preview.js — the preview pane: shows the saved draft in an iframe and
 * replays unsaved edits into it (via preview-bridge.js inside the page).
 */
import { store } from "./store.js";
import { $, $$ } from "./dom.js";
import { buildThemeCss } from "/shared/theme.js";

const frame = $("#preview-frame");
const pane = $(".preview");
let page = "index.html";
let mode = "dark";
let ready = false;
let pendingFocus = null;
const handlers = { select: () => {} };

const send = (msg) => { if (ready) frame.contentWindow.postMessage(msg, location.origin); };

/** Everything unsaved, as bridge messages. */
function unsavedMessages() {
  const msgs = [];
  for (const [key, edit] of store.edits) {
    const field = store.fields.get(key);
    if (field.pages.includes(page)) msgs.push({ type: "field", key, kind: field.kind, ...edit });
  }
  for (const [slot, value] of store.images) msgs.push({ type: "image", slot, value: { ...value, src: store.url(value.src), srcset: resolveSrcset(value.srcset) } });
  if (store.theme) msgs.push({ type: "theme", css: buildThemeCss(store.theme) });
  msgs.push({ type: "mode", mode });
  return msgs;
}

const resolveSrcset = (srcset) => String(srcset || "").split(",").map((s) => s.trim()).filter(Boolean)
  .map((part) => { const [path, w] = part.split(/\s+/); return `${store.url(path)} ${w}`; }).join(", ");

export const preview = {
  get page() { return page; },

  load(nextPage = page) {
    page = nextPage;
    ready = false;
    $$("[data-page]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.page === page)));
    frame.src = `/preview/${store.loaded.draftSha}/${page}`;
    $("#preview-note").textContent = page === "photography.html" ? "Photography page is always dark" : "";
  },

  /** Push the current state of one thing to the preview. */
  field(key) {
    const field = store.fields.get(key);
    if (!field?.pages.includes(page)) return;
    send({ type: "field", key, kind: field.kind, value: store.value(key), color: store.color(key) });
  },
  image(slot) {
    const value = store.image(slot);
    send({ type: "image", slot, value: { ...value, src: store.url(value.src), srcset: resolveSrcset(value.srcset) } });
  },
  theme() { send({ type: "theme", css: buildThemeCss(store.themeChoices()) }); },

  /** Scroll to (and outline) a field, switching page if needed. */
  focus(key) {
    const field = store.fields.get(key);
    if (field && !field.pages.includes(page)) { pendingFocus = key; preview.load(field.pages[0]); return; }
    send({ type: "focus", key });
  },

  setMode(next) {
    mode = next;
    $$("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
    send({ type: "mode", mode });
  },

  onSelect(fn) { handlers.select = fn; },
};

window.addEventListener("message", (e) => {
  if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
  const m = e.data || {};
  if (m.type === "ready") {
    ready = true;
    send({ type: "batch", messages: unsavedMessages() });
    if (pendingFocus) { send({ type: "focus", key: pendingFocus }); pendingFocus = null; }
  } else if (m.type === "select") {
    handlers.select(m);
  } else if (m.type === "navigate") {
    preview.load(m.page);
  }
});

$$("[data-page]").forEach((b) => b.addEventListener("click", () => preview.load(b.dataset.page)));
$$("[data-mode]").forEach((b) => b.addEventListener("click", () => preview.setMode(b.dataset.mode)));
$$("[data-width]").forEach((b) => b.addEventListener("click", () => {
  $$("[data-width]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  pane.classList.toggle("is-mobile", b.dataset.width === "mobile");
}));
