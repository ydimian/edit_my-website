/**
 * main.js — starts the editor and runs the top bar.
 *
 *   Edit      changes stay in this browser tab until you save
 *   Save      writes them to the private draft (the preview shows the draft)
 *   Release   publishes the saved draft to youhannad.com
 */
import { api } from "./api.js";
import { store } from "./store.js";
import { preview } from "./preview.js";
import { h, $, $$, toast, confirmBox } from "./dom.js";
import { renderText, revealField } from "./panels/text.js";
import { renderPhotos } from "./panels/photos.js";
import { renderTheme } from "./panels/theme.js";

const chip = $("#status-chip");
const saveBtn = $("#btn-save");
const releaseBtn = $("#btn-release");
const menu = $("#menu");
const menuBtn = $("#btn-menu");
let session = null;
let busy = "";      // what's in progress ("Saving…"), or ""
let failure = "";   // a load error, or ""

/* ---------- start ---------- */

boot();

async function boot() {
  try {
    session = await api.session();
  } catch (e) {
    return fail(e.message);
  }
  if (session.liveUrl) $("#menu-live").href = session.liveUrl;
  if (!session.tokenConfigured) {
    showBanner(h("span", {}, "The editor isn't connected to your site yet: add the ", h("code", {}, "GITHUB_TOKEN"), " secret to this Worker in Cloudflare (see the README)."));
    return fail("Not connected");
  }
  if (session.dev) showBanner("Local development mode: sign-in is bypassed.");
  await reload();
}

/** (Re)load everything from the draft. */
async function reload() {
  setBusy("Loading…");
  try {
    store.setLoaded(await api.load());
    failure = "";
    preview.load();
  } catch (e) {
    fail(e.message);
  } finally {
    setBusy("");
  }
}

function fail(message) {
  failure = message;
  showBanner(h("span", {}, `Couldn't load the editor: ${message} `, h("button", { class: "link-btn", type: "button", onclick: () => location.reload() }, "Try again")));
  updateStatus();
}

function showBanner(content) {
  const banner = $("#banner");
  banner.replaceChildren(content);
  banner.hidden = false;
  document.body.classList.add("has-banner");
}

/* ---------- panels ---------- */

store.on((e) => {
  if (e.type === "loaded") { renderText(); renderPhotos(); renderTheme(); }
  else if (e.type === "photos") renderPhotos();
  else if (e.type === "bulk") renderText(); // captions filled in from a photo
  updateStatus();
});

function selectTab(name) {
  $$("[data-tab]").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
  $$(".panel").forEach((p) => (p.hidden = p.id !== `panel-${name}`));
  try { localStorage.setItem("editor-tab", name); } catch { /* storage unavailable */ }
}
$$("[data-tab]").forEach((t) => t.addEventListener("click", () => selectTab(t.dataset.tab)));
try { const tab = localStorage.getItem("editor-tab"); if (tab && $(`[data-tab="${tab}"]`)) selectTab(tab); } catch { /* storage unavailable */ }

// Click something in the preview to edit it
preview.onSelect(({ key, image }) => {
  if (image) { selectTab("photos"); return; }
  selectTab("text");
  document.body.classList.remove("show-preview");
  revealField(key);
});

// Phones: the preview is a full-screen overlay
$("#btn-show-preview").addEventListener("click", () => document.body.classList.add("show-preview"));
$("#btn-hide-preview").addEventListener("click", () => document.body.classList.remove("show-preview"));

/* ---------- status ---------- */

const draftAhead = () => Boolean(store.loaded?.changedFiles?.length);

function updateStatus() {
  const dirty = store.loaded ? store.dirtyCount() : 0;
  let state, text;
  if (busy) [state, text] = ["loading", busy];
  else if (failure) [state, text] = ["error", failure];
  else if (dirty) [state, text] = ["dirty", `${dirty} unsaved change${dirty === 1 ? "" : "s"}`];
  else if (draftAhead()) [state, text] = ["draft", "Draft saved · not live yet"];
  else [state, text] = ["live", "Up to date with the live site"];
  chip.dataset.state = state;
  chip.textContent = text;
  chip.title = text;

  const ready = Boolean(store.loaded) && !busy;
  saveBtn.disabled = !ready || !dirty;
  saveBtn.classList.toggle("is-dirty", ready && dirty > 0);
  releaseBtn.disabled = !ready || (!dirty && !draftAhead());
  releaseBtn.title = dirty ? "Save your changes and publish them to youhannad.com" : "Publish the saved draft to youhannad.com";
  $("#menu-undo").disabled = !ready || !dirty;
  $("#menu-discard").disabled = !ready || !draftAhead();
}

function setBusy(label) {
  busy = label;
  updateStatus();
}

/* ---------- save / release / discard ---------- */

async function save() {
  if (busy || !store.isDirty()) return false;
  try {
    await store.sendUploads(api.upload, (done, total) => setBusy(`Uploading photo file ${done + 1} of ${total}…`));
    setBusy("Saving…");
    const result = await api.save(store.buildSave());
    setBusy("");
    await reload();
    if (!result.unchanged) toast("Saved to your draft. Check the preview, then press Release to publish.", "ok");
    return true;
  } catch (e) {
    setBusy("");
    toast(e.message, "error", 9000);
    return false;
  }
}

async function release() {
  if (busy) return;
  if (store.isDirty()) {
    if (!(await confirmBox("Save and release?", "Your unsaved changes will be saved first, then everything in the draft goes live on youhannad.com.", "Save and continue"))) return;
    if (!(await save())) return;
    if (!draftAhead()) { toast("Nothing changed, so there's nothing to release."); return; }
  }
  const files = store.loaded.changedFiles;
  const body = h("div", {},
    h("p", { style: { margin: "0 0 8px", color: "var(--ink-2)" } }, `This publishes your saved draft to ${session.liveUrl || "the live site"}. It goes live about a minute after you release.`),
    h("p", { class: "fld__hint" }, `${files.length} file${files.length === 1 ? "" : "s"} changed:`),
    h("ul", { class: "file-list" }, files.slice(0, 30).map((f) => h("li", { text: `${f.path}${f.status === "added" ? " (new)" : f.status === "removed" ? " (deleted)" : ""}` })),
      files.length > 30 ? h("li", { text: `…and ${files.length - 30} more` }) : null),
  );
  if (!(await confirmBox("Release to the live site?", body, "Release", "accent"))) return;

  setBusy("Releasing…");
  try {
    const result = await api.release();
    setBusy("");
    await reload();
    if (result.released) {
      toast(h("span", {}, "Released. Your site updates in about a minute: ", h("a", { href: session.liveUrl || "/", target: "_blank", rel: "noopener" }, "open it ↗")), "ok", 9000);
    } else {
      toast("The live site already matches the draft.");
    }
  } catch (e) {
    setBusy("");
    toast(e.message, "error", 9000);
  }
}

async function discard() {
  closeMenu();
  const ok = await confirmBox("Discard the saved draft?",
    "The draft is reset to match the live site. Everything saved since your last release, and any unsaved changes, will be lost. The live site isn't affected.",
    "Discard draft", "danger");
  if (!ok) return;
  setBusy("Discarding…");
  try {
    await api.discard();
    setBusy("");
    await reload();
    toast("Draft reset to the live site.");
  } catch (e) {
    setBusy("");
    toast(e.message, "error", 9000);
  }
}

async function undoUnsaved() {
  closeMenu();
  if (!(await confirmBox("Undo unsaved changes?", "Everything you've changed since your last save will be undone.", "Undo changes", "danger"))) return;
  store.undoAll();
  preview.load();
}

saveBtn.addEventListener("click", save);
releaseBtn.addEventListener("click", release);
$("#menu-discard").addEventListener("click", discard);
$("#menu-undo").addEventListener("click", undoUnsaved);

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
});

window.addEventListener("beforeunload", (e) => {
  if (store.loaded && store.isDirty()) { e.preventDefault(); e.returnValue = ""; }
});

/* ---------- menu ---------- */

function closeMenu() { menu.hidden = true; menuBtn.setAttribute("aria-expanded", "false"); }
menuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  menu.hidden = !menu.hidden;
  menuBtn.setAttribute("aria-expanded", String(!menu.hidden));
});
document.addEventListener("click", (e) => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
menu.addEventListener("click", (e) => { if (e.target.closest("a")) closeMenu(); });
