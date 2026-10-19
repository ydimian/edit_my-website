/**
 * html-scan.js — a small, fast HTML element scanner with source offsets.
 *
 * Cloudflare's free plan allows about 10 ms of CPU per request, and a full
 * HTML parser takes longer than that on the home page. The editor only needs
 * to find elements and where their tags start and end in the source, in
 * markup we write ourselves, so this scanner covers what the site uses:
 * comments, void and self-closing (SVG) elements, raw-text elements
 * (<script>, <style>, <title>, <textarea>, <noscript>), and the usual implied end tags
 * (<li>, <option>, <p>). test/scan.test.mjs checks it against parse5 on the
 * real pages.
 *
 * Element: { tag, attrs: [{ name, value }], start, end,
 *            startTag: { start, end }, endTag: { start, end } | null, children }
 */
import { decodeEntities } from "../public/shared/markup.js";

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const RAW = new Set(["script", "style", "title", "textarea", "noscript"]);
const CLOSES_P = new Set(["address", "article", "aside", "blockquote", "details", "div", "dl", "fieldset", "figcaption", "figure", "footer", "form",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "main", "nav", "ol", "p", "pre", "section", "table", "ul"]);
const LIST = new Set(["ul", "ol"]);

const TAG_NAME = /[a-zA-Z][^\s/>]*/y;
const ATTR = /\s*([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/y;

/** Parse `html` into a tree of elements (the returned root has tag "#root"). */
export function scanHtml(html) {
  const lower = html.toLowerCase();
  const root = { tag: "#root", attrs: [], children: [], start: 0, end: html.length, startTag: null, endTag: null };
  const stack = [root];
  const closeTo = (index, at) => { // implicitly close stack[index..] at offset `at`
    while (stack.length > index) { const el = stack.pop(); el.end = at; }
  };

  let i = 0;
  for (;;) {
    const lt = html.indexOf("<", i);
    if (lt < 0) break;
    const next = html[lt + 1];

    if (html.startsWith("<!--", lt)) { const e = html.indexOf("-->", lt + 4); i = e < 0 ? html.length : e + 3; continue; }
    if (next === "!" || next === "?") { const e = html.indexOf(">", lt); i = e < 0 ? html.length : e + 1; continue; }

    if (next === "/") { // end tag
      TAG_NAME.lastIndex = lt + 2;
      const m = TAG_NAME.exec(html);
      if (!m) { i = lt + 1; continue; }
      const gt = html.indexOf(">", TAG_NAME.lastIndex);
      const end = gt < 0 ? html.length : gt + 1;
      const name = m[0].toLowerCase();
      const at = stack.findLastIndex((el) => el.tag === name);
      if (at > 0) {
        closeTo(at + 1, lt);
        const el = stack.pop();
        el.endTag = { start: lt, end };
        el.end = end;
      }
      i = end;
      continue;
    }

    TAG_NAME.lastIndex = lt + 1;
    const m = TAG_NAME.exec(html);
    if (!m) { i = lt + 1; continue; }
    const tag = m[0].toLowerCase();

    const attrs = [];
    let p = TAG_NAME.lastIndex;
    for (;;) {
      ATTR.lastIndex = p;
      const a = ATTR.exec(html);
      if (!a) {
        if (html[p] === "/" && html[p + 1] !== ">") { p++; continue; } // stray slash between attributes
        break;
      }
      const name = a[1].toLowerCase();
      const raw = a[2] ?? a[3] ?? a[4] ?? "";
      if (!attrs.some((x) => x.name === name)) attrs.push({ name, value: raw.includes("&") ? decodeEntities(raw) : raw });
      p = ATTR.lastIndex;
    }
    const gt = html.indexOf(">", p);
    const startEnd = gt < 0 ? html.length : gt + 1;
    const selfClosing = html[startEnd - 2] === "/";

    // Implied end tags
    if (tag === "li") {
      const li = stack.findLastIndex((el) => el.tag === "li");
      const list = stack.findLastIndex((el) => LIST.has(el.tag));
      if (li > 0 && li > list) closeTo(li, lt);
    } else if (tag === "option" && stack.at(-1).tag === "option") {
      closeTo(stack.length - 1, lt);
    } else if (CLOSES_P.has(tag) && stack.at(-1).tag === "p") {
      closeTo(stack.length - 1, lt);
    }

    const el = { tag, attrs, children: [], start: lt, end: startEnd, startTag: { start: lt, end: startEnd }, endTag: null };
    stack.at(-1).children.push(el);
    i = startEnd;

    if (VOID.has(tag) || selfClosing) continue;
    if (RAW.has(tag)) {
      const close = lower.indexOf(`</${tag}`, startEnd);
      if (close < 0) { el.end = html.length; i = html.length; continue; }
      const closeEnd = html.indexOf(">", close);
      el.endTag = { start: close, end: closeEnd < 0 ? html.length : closeEnd + 1 };
      el.end = el.endTag.end;
      i = el.end;
      continue;
    }
    stack.push(el);
  }
  closeTo(1, html.length);
  return root;
}
