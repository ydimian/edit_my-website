/**
 * dom.js — tiny helpers for building the editor UI without a framework.
 */

/** h("button", { class: "btn", onclick }, "Label") -> element */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v; // a textarea has no value attribute
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function debounce(fn, ms = 150) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function toast(message, kind = "info", ms = 4200) {
  const el = h("div", { class: `toast toast--${kind}` });
  if (message instanceof Node) el.append(message); else el.textContent = message;
  document.getElementById("toasts").append(el);
  setTimeout(() => el.remove(), ms);
  return el;
}

/** Grow a textarea to fit its content. */
export function autoGrow(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight + 2}px`;
}

/**
 * A modal dialog. Resolves with the value passed to close(), or null if dismissed.
 *   modal({ title, body: Node, actions: [{ label, value, kind }] })
 */
export function modal({ title, body, actions = [{ label: "OK", value: true, kind: "solid" }], wide = false, onOpen }) {
  return new Promise((resolve) => {
    const dlg = h("dialog", wide ? { style: { width: "min(980px, calc(100vw - 24px))" } } : {});
    const close = (value) => { dlg.close(); dlg.remove(); resolve(value); };
    const foot = h("div", { class: "dlg__foot" }, h("div", { class: "right" },
      actions.map((a) => h("button", { class: `btn ${a.kind ? `btn--${a.kind}` : ""}`, type: "button", onclick: () => close(typeof a.value === "function" ? a.value() : a.value) }, a.label)),
    ));
    dlg.append(h("div", { class: "dlg" },
      h("div", { class: "dlg__head" }, h("h3", { text: title }), h("button", { class: "btn btn--ghost btn--sm", type: "button", onclick: () => close(null) }, "Close")),
      h("div", { class: "dlg__body" }, body),
      actions.length ? foot : null,
    ));
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(null); });
    document.body.append(dlg);
    dlg.showModal();
    onOpen?.(dlg, close);
  });
}

export const confirmBox = (title, text, label = "Continue", kind = "solid") =>
  modal({ title, body: typeof text === "string" ? h("p", { style: { margin: 0, color: "var(--ink-2)" } }, text) : text, actions: [{ label: "Cancel", value: false }, { label, value: true, kind }] });
