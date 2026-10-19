/**
 * preview-bridge.js — injected into every draft preview page.
 *
 * Inside the editor (iframe) it applies your unsaved edits live, outlines
 * editable text on hover, and tells the editor which text you clicked.
 * Opened on its own (/preview/latest/), it just shows a "Draft preview" badge.
 */
import { markupToHtml } from "/shared/markup.js";

const embedded = window.parent !== window;
const page = location.pathname.split("/").pop() || "index.html";
const post = (msg) => window.parent.postMessage(msg, location.origin);

if (!embedded) {
  addEventListener("DOMContentLoaded", () => {
    const badge = document.createElement("div");
    badge.textContent = "Draft preview · not live";
    Object.assign(badge.style, { position: "fixed", bottom: "14px", left: "14px", zIndex: 9999, padding: "6px 12px", borderRadius: "999px", background: "#ef6a3f", color: "#fff", font: "600 12px system-ui, sans-serif", boxShadow: "0 8px 24px rgba(0,0,0,.3)" });
    document.body.append(badge);
  });
} else {
  const style = document.createElement("style");
  style.textContent = `
    [data-edit] { cursor: text; transition: outline-color .15s; outline: 1px dashed transparent; outline-offset: 3px; }
    [data-edit]:hover { outline-color: rgba(239,106,63,.7); }
    .editor-focus { outline: 2px solid #ef6a3f !important; outline-offset: 4px; border-radius: 2px; }
    [data-edit-img] { cursor: pointer; }
  `;
  document.head.append(style);

  /** Every element for a key: on the page, inside <template>s, and in open case-study popups. */
  const nodesFor = (attr, key) => {
    const sel = `[${attr}="${CSS.escape(key)}"]`;
    const out = [...document.querySelectorAll(sel)];
    for (const tpl of document.querySelectorAll("template")) out.push(...tpl.content.querySelectorAll(sel));
    return out;
  };

  function applyField({ key, kind, value, color }) {
    for (const el of nodesFor("data-edit", key)) {
      if (value !== undefined) {
        if (kind === "plain") {
          el.textContent = value;
          if (el.tagName === "TITLE") document.title = value;
        } else if (kind === "list") {
          const template = el.querySelector("li");
          el.replaceChildren(...value.filter((v) => v.trim()).map((item) => {
            const li = template ? template.cloneNode(false) : document.createElement("li");
            li.innerHTML = markupToHtml(item);
            return li;
          }));
        } else {
          el.innerHTML = kind === "html" ? value : markupToHtml(value);
        }
      }
      if (color !== undefined) {
        if (color?.dark) {
          el.setAttribute("data-color", "");
          el.style.setProperty("--tc-dark", color.dark);
          el.style.setProperty("--tc-light", color.light || color.dark);
        } else {
          el.removeAttribute("data-color");
          el.style.removeProperty("--tc-dark");
          el.style.removeProperty("--tc-light");
        }
      }
    }
  }

  function applyImage({ slot, value }) {
    for (const img of nodesFor("data-edit-img", slot)) {
      img.src = value.src;
      if (value.srcset) img.srcset = value.srcset; else img.removeAttribute("srcset");
      img.width = value.width; img.height = value.height; img.alt = value.alt || "";
    }
    for (const a of nodesFor("data-edit-img-link", slot)) a.setAttribute("href", value.photoId ? `#${value.photoId}` : "#gallery");
    for (const hex of nodesFor("data-edit-img-hex", slot)) if (value.color) { hex.style.setProperty("--swatch", value.color); hex.textContent = value.color.toUpperCase(); }
  }

  function applyTheme(css) {
    for (const link of document.querySelectorAll('link[href*="theme.css"]')) link.disabled = true;
    let tag = document.getElementById("editor-theme");
    if (!tag) { tag = document.createElement("style"); tag.id = "editor-theme"; document.head.append(tag); }
    tag.textContent = css;
  }

  function focusKey(key) {
    document.querySelectorAll(".editor-focus").forEach((el) => el.classList.remove("editor-focus"));
    const el = document.querySelector(`[data-edit="${CSS.escape(key)}"]`);
    if (!el) return false;
    el.classList.add("editor-focus");
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    return true;
  }

  addEventListener("message", (e) => {
    if (e.origin !== location.origin || !e.data || typeof e.data !== "object") return;
    const m = e.data;
    if (m.type === "field") applyField(m);
    else if (m.type === "image") applyImage(m);
    else if (m.type === "theme") applyTheme(m.css);
    else if (m.type === "focus") post({ type: "focused", key: m.key, found: focusKey(m.key) });
    else if (m.type === "mode" && !document.documentElement.hasAttribute("data-force-theme")) {
      document.documentElement.dataset.theme = m.mode;
      dispatchEvent(new CustomEvent("themechange", { detail: m.mode }));
    } else if (m.type === "batch") m.messages.forEach((msg) => dispatchEvent(new MessageEvent("message", { data: msg, origin: location.origin })));
  });

  // Click text to edit it; stay on this page instead of following links
  document.addEventListener("click", (e) => {
    const editable = e.target.closest("[data-edit], [data-edit-img]");
    if (editable) post({ type: "select", key: editable.getAttribute("data-edit") || editable.getAttribute("data-edit-img"), image: !editable.hasAttribute("data-edit") });
    const a = e.target.closest("a[href]");
    if (!a) return;
    const href = a.getAttribute("href");
    if (href.startsWith("#")) return;
    e.preventDefault();
    const target = href.split(/[?#]/)[0].split("/").pop();
    if (target === "photography.html" || target === "index.html") post({ type: "navigate", page: target });
  }, true);

  post({ type: "ready", page });
}
