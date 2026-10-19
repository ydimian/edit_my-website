/**
 * panels/text.js — every piece of text on the site, grouped by section.
 *
 * Formatting: *italic*  **bold**  ==accent highlight==  (Enter = line break).
 * Each field can also get its own colour: you pick the dark-mode colour and
 * the light-mode one is derived (shown as the right half of the swatch).
 */
import { store } from "../store.js";
import { preview } from "../preview.js";
import { h, $, $$, autoGrow, debounce } from "../dom.js";
import { describeKey, GROUPS, pageLabel } from "../labels.js";
import { deriveLight } from "/shared/palette.js";

const root = $("#panel-text");
let query = "";

export function renderText() {
  const valueOf = (k) => store.value(k);
  const groups = new Map(GROUPS.map(([id, label]) => [id, { label, subs: new Map() }]));

  for (const field of store.fields.values()) {
    const d = describeKey(field.key, valueOf);
    if (!groups.has(d.group)) groups.set(d.group, { label: d.groupLabel, subs: new Map() });
    const g = groups.get(d.group);
    const subId = d.sub || "";
    if (!g.subs.has(subId)) g.subs.set(subId, { label: d.subLabel, fields: [] });
    g.subs.get(subId).fields.push({ field, label: d.label });
  }

  const open = new Set($$("details.group[open]", root).map((el) => el.dataset.group));
  const scroll = root.scrollTop;

  root.replaceChildren(
    h("h2", { text: "Text" }),
    h("p", { class: "lede" }, "Everything written on your site. Click any text in the preview to jump to it here."),
    h("div", { class: "legend" },
      h("span", {}, h("code", {}, "*italic*")), h("span", {}, h("code", {}, "**bold**")),
      h("span", {}, h("code", {}, "==highlight=="), " accent colour"), h("span", {}, "Enter = new line"),
    ),
    h("div", { class: "toolbar" },
      h("input", { class: "search", type: "search", placeholder: "Search text…", value: query, oninput: debounce((e) => { query = e.target.value.toLowerCase(); filter(); }, 120) }),
      h("button", { class: "btn btn--sm", type: "button", onclick: () => $$("details.group", root).forEach((d) => (d.open = true)) }, "Expand all"),
      h("button", { class: "btn btn--sm", type: "button", onclick: () => $$("details.group", root).forEach((d) => (d.open = false)) }, "Collapse"),
    ),
    ...[...groups].filter(([, g]) => g.subs.size).map(([id, g]) => renderGroup(id, g, open.has(id))),
  );
  $$("textarea", root).forEach(autoGrow);
  filter();
  root.scrollTop = scroll;
}

function renderGroup(id, group, isOpen) {
  const count = h("span", { class: "group__count" });
  const body = h("div", { class: "group__body" });
  for (const [subId, sub] of group.subs) {
    const fields = sub.fields.map(({ field, label }) => renderField(field, label));
    body.append(subId ? h("div", { class: "sub", "data-sub": subId }, h("p", { class: "sub__title", text: sub.label }), ...fields) : h("div", { class: "group__flat", style: { display: "grid", gap: "14px" } }, ...fields));
  }
  const details = h("details", { class: "group", "data-group": id, open: isOpen }, h("summary", {}, group.label, count), body);
  details.addEventListener("toggle", () => { if (details.open) $$("textarea", details).forEach(autoGrow); });
  updateCount(details);
  return details;
}

function renderField(field, label) {
  const id = `f-${field.key.replace(/[^a-z0-9]/gi, "-")}`;
  const isList = field.kind === "list";
  const value = store.value(field.key);
  const textarea = h("textarea", {
    id, rows: 1, spellcheck: true,
    value: isList ? value.join("\n") : value,
    oninput: (e) => { autoGrow(e.target); commit(); },
    onfocus: () => { el.classList.add("is-focus"); preview.focus(field.key); },
    onblur: () => el.classList.remove("is-focus"),
    onkeydown: (e) => {
      if (!(e.ctrlKey || e.metaKey) || field.kind === "plain") return;
      const k = e.key.toLowerCase();
      if (k === "i") { e.preventDefault(); wrap("*"); }
      else if (k === "b") { e.preventDefault(); wrap("**"); }
      else if (k === "e") { e.preventDefault(); wrap("=="); }
    },
  });
  if (field.kind === "plain") textarea.addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });

  function commit() {
    const raw = textarea.value;
    store.setField(field.key, { value: isList ? raw.split("\n").map((s) => s.trim()).filter(Boolean) : raw });
    preview.field(field.key);
    refresh();
  }

  function wrap(marker) {
    const { selectionStart: s, selectionEnd: e, value: v } = textarea;
    const selected = v.slice(s, e) || "text";
    textarea.value = `${v.slice(0, s)}${marker}${selected}${marker}${v.slice(e)}`;
    textarea.setSelectionRange(s + marker.length, s + marker.length + selected.length);
    textarea.focus();
    commit();
  }

  const swatch = h("label", { class: "swatch-btn", title: "Text colour (pick the dark-mode colour; light mode is derived)" });
  const colorInput = h("input", { type: "color", oninput: (e) => setColor(e.target.value) });
  swatch.append(colorInput);
  const clearColor = h("button", { class: "link-btn", type: "button", onclick: () => setColor(null) }, "No colour");
  function setColor(hex) {
    store.setField(field.key, { color: hex ? { dark: hex, light: deriveLight("text", hex) } : null });
    preview.field(field.key);
    refresh();
  }

  const revert = h("button", { class: "link-btn fld__revert", type: "button", onclick: () => {
    store.revertField(field.key);
    const v = store.value(field.key);
    textarea.value = isList ? v.join("\n") : v;
    autoGrow(textarea);
    preview.field(field.key);
    refresh();
  } }, "Undo");

  const tools = field.kind === "plain" ? [] : [
    h("button", { class: "tool tool--i", type: "button", title: "Italic (Ctrl+I)", onclick: () => wrap("*") }, "I"),
    h("button", { class: "tool tool--b", type: "button", title: "Bold (Ctrl+B)", onclick: () => wrap("**") }, "B"),
    h("button", { class: "tool tool--hl", type: "button", title: "Accent highlight (Ctrl+E)", onclick: () => wrap("==") }, "★"),
    swatch, clearColor,
  ];

  const el = h("div", { class: "fld", "data-key": field.key },
    h("div", { class: "fld__head" },
      h("label", { for: id, text: label }),
      h("span", { class: "fld__page", text: pageLabel(field.pages) }),
      h("span", { class: "fld__tools" }, ...tools, revert),
    ),
    textarea,
    isList ? h("p", { class: "fld__hint", text: "One item per line" }) : null,
  );

  function refresh() {
    const dirty = store.edits.has(field.key);
    el.classList.toggle("is-dirty", dirty);
    revert.hidden = !dirty;
    const color = store.color(field.key);
    swatch.classList.toggle("has-color", Boolean(color));
    if (color) { swatch.style.setProperty("--sw-dark", color.dark); swatch.style.setProperty("--sw-light", color.light); colorInput.value = color.dark; }
    clearColor.hidden = !color;
    el.dataset.search = `${label} ${textarea.value}`.toLowerCase();
    const group = el.closest("details.group");
    if (group) updateCount(group);
  }
  queueMicrotask(refresh);
  return el;
}

function updateCount(details) {
  const n = $$(".fld.is-dirty", details).length;
  $(".group__count", details).textContent = n ? `${n} edited` : "";
}

function filter() {
  for (const group of $$("details.group", root)) {
    let any = 0;
    for (const fld of $$(".fld", group)) {
      const show = !query || (fld.dataset.search || "").includes(query);
      fld.hidden = !show;
      if (show) any++;
    }
    for (const sub of $$(".sub", group)) sub.hidden = !$$(".fld:not([hidden])", sub).length;
    group.hidden = !any;
    if (query && any) group.open = true;
  }
}

/** Open the group holding `key` and focus its field (used when you click text in the preview). */
export function revealField(key) {
  const fld = $(`.fld[data-key="${CSS.escape(key)}"]`, root);
  if (!fld) return;
  query = "";
  const search = $(".search", root);
  if (search) search.value = "";
  filter();
  fld.closest("details.group").open = true;
  fld.scrollIntoView({ block: "center", behavior: "smooth" });
  const ta = $("textarea", fld);
  ta.focus({ preventScroll: true });
  autoGrow(ta);
}
