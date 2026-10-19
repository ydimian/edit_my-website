/**
 * html-regions.js — read and rewrite the editable parts of the site's HTML.
 *
 * The site marks editable elements with attributes:
 *   data-edit="key"           text, a list (<ul>/<ol>), or the page <title>
 *   data-edit-img="slot"      an <img> whose picture can be swapped
 *   data-edit-img-link="slot" an <a> that should link to that picture
 *   data-edit-img-hex="slot"  a colour swatch showing that picture's colour
 *
 * HTML is scanned with source offsets (html-scan.js), and edits are spliced
 * into the original text at exact offsets. Anything that isn't edited stays
 * byte-for-byte identical, so diffs stay small and nothing else can break.
 */
import { scanHtml } from "./html-scan.js";
import { htmlToMarkup, markupToHtml, htmlToText, textToHtml } from "../public/shared/markup.js";

const MARKERS = ["data-edit", "data-edit-img", "data-edit-img-link", "data-edit-img-hex"];

/* ---------- tree helpers ---------- */

function* walk(node) {
  yield node;
  for (const child of node.children) yield* walk(child);
}
const getAttr = (el, name) => el.attrs?.find((a) => a.name === name)?.value;

/* ---------- scanning ---------- */

/**
 * Find every marked element. Returns regions with their kind, key and the
 * source offsets of the start tag and the inner content.
 */
export function scanRegions(html) {
  // A save reads and then rewrites the same pages: scan each text once (results are never mutated)
  if (cache.has(html)) return cache.get(html);
  const regions = [];
  for (const el of walk(scanHtml(html))) {
    if (!el.startTag) continue;
    for (const marker of MARKERS) {
      const key = getAttr(el, marker);
      if (key == null) continue;
      const region = {
        marker,
        key,
        tag: el.tag,
        el,
        startTag: { ...el.startTag },
        inner: el.endTag ? { start: el.startTag.end, end: el.endTag.start } : null,
      };
      region.kind = kindOf(region, html);
      regions.push(region);
    }
  }
  assertNoNesting(regions);
  cache.set(html, regions);
  if (cache.size > 4) cache.delete(cache.keys().next().value);
  return regions;
}
const cache = new Map();

function kindOf(region, html) {
  if (region.marker === "data-edit-img") return "image";
  if (region.marker === "data-edit-img-link") return "image-link";
  if (region.marker === "data-edit-img-hex") return "image-hex";
  if (region.tag === "title") return "plain";
  if (region.tag === "ul" || region.tag === "ol") {
    const items = listItems(region, html);
    return items.every((i) => htmlToMarkup(i.html) !== null) ? "list" : "html";
  }
  return htmlToMarkup(innerSource(region, html)) !== null ? "text" : "html";
}

function assertNoNesting(regions) {
  const content = regions.filter((r) => r.inner && r.marker === "data-edit").sort((a, b) => a.inner.start - b.inner.start);
  for (let i = 1; i < content.length; i++) {
    const a = content[i - 1], b = content[i];
    if (b.inner.start < a.inner.end) throw new Error(`Editable region "${b.key}" is nested inside "${a.key}"`);
  }
}

const innerSource = (region, html) => html.slice(region.inner.start, region.inner.end);

function listItems(region, html) {
  return region.el.children
    .filter((n) => n.tag === "li")
    .map((li) => ({
      open: html.slice(li.startTag.start, li.startTag.end),
      start: li.start,
      end: li.end,
      html: html.slice(li.startTag.end, li.endTag ? li.endTag.start : li.end),
    }));
}

/* ---------- reading values ---------- */

/** The editable value of a region, in the form the editor works with. */
export function readRegion(region, html) {
  const color = readColor(region.el);
  switch (region.kind) {
    case "plain": return { value: htmlToText(innerSource(region, html)), color };
    case "text": return { value: htmlToMarkup(innerSource(region, html)), color };
    case "html": return { value: innerSource(region, html).trim(), color };
    case "list": return { value: listItems(region, html).map((i) => htmlToMarkup(i.html)), color };
    case "image": {
      const a = (n) => getAttr(region.el, n) ?? "";
      return { value: { src: a("src"), srcset: a("srcset"), alt: a("alt"), width: Number(a("width")) || 0, height: Number(a("height")) || 0 } };
    }
    default: return { value: null };
  }
}

function readColor(el) {
  if (getAttr(el, "data-color") == null) return null;
  const style = getAttr(el, "style") || "";
  const dark = style.match(/--tc-dark:\s*(#[0-9a-f]{3,6})/i)?.[1];
  const light = style.match(/--tc-light:\s*(#[0-9a-f]{3,6})/i)?.[1];
  return dark ? { dark, light: light || dark } : null;
}

/* ---------- writing values ---------- */

const escapeAttr = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;");

function buildStartTag(tag, attrs) {
  const parts = attrs.map(({ name, value }) => (value === "" ? ` ${name}` : ` ${name}="${escapeAttr(value)}"`));
  return `<${tag}${parts.join("")}>`;
}

function setAttr(attrs, name, value) {
  const i = attrs.findIndex((a) => a.name === name);
  if (value == null) { if (i >= 0) attrs.splice(i, 1); return; }
  if (i >= 0) attrs[i] = { name, value: String(value) };
  else attrs.push({ name, value: String(value) });
}

/** Apply or clear a per-text colour (dark value + derived light value). */
function withColor(attrs, color) {
  const next = attrs.map((a) => ({ ...a }));
  const style = (next.find((a) => a.name === "style")?.value || "")
    .split(";").map((s) => s.trim()).filter((s) => s && !/^--tc-(dark|light)\s*:/.test(s));
  if (color?.dark) {
    style.push(`--tc-dark:${color.dark}`, `--tc-light:${color.light || color.dark}`);
    setAttr(next, "data-color", "");
  } else {
    setAttr(next, "data-color", null);
  }
  setAttr(next, "style", style.length ? style.join("; ") : null);
  return next;
}

function renderList(region, html, items) {
  const existing = listItems(region, html);
  const open = existing[0]?.open || "<li>";
  const close = "</li>";
  let leading = "", sep = "", trailing = "";
  if (existing.length) {
    leading = html.slice(region.inner.start, existing[0].start);
    trailing = html.slice(existing.at(-1).end, region.inner.end);
    sep = existing.length > 1 ? html.slice(existing[0].end, existing[1].start) : (leading.includes("\n") ? leading : "");
  }
  const body = items.filter((t) => String(t).trim()).map((t) => `${open}${markupToHtml(t)}${close}`).join(sep);
  return `${leading}${body}${trailing}`;
}

/**
 * Apply edits to one HTML document.
 *   edits: Map key -> { value?, color? }    (text / list / plain / html)
 *   images: Map slot -> { src, srcset, width, height, alt, photoId, color }
 * Only regions whose key is present are touched.
 */
export function applyEdits(html, { edits = new Map(), images = new Map() } = {}) {
  const regions = scanRegions(html);
  const ops = []; // { start, end, text }

  for (const region of regions) {
    if (region.marker === "data-edit" && edits.has(region.key)) {
      const edit = edits.get(region.key);
      if ("value" in edit) {
        let inner;
        if (region.kind === "plain") inner = textToHtml(edit.value);
        else if (region.kind === "list") inner = renderList(region, html, edit.value || []);
        else if (region.kind === "html") inner = String(edit.value ?? "");
        else inner = markupToHtml(edit.value);
        if (inner !== innerSource(region, html)) ops.push({ ...region.inner, text: inner });
      }
      if ("color" in edit) {
        const attrs = withColor(region.el.attrs, edit.color);
        ops.push({ ...region.startTag, text: buildStartTag(region.tag, attrs) });
      }
    }

    const image = images.get(region.key);
    if (!image) continue;
    if (region.kind === "image") {
      const attrs = region.el.attrs.map((a) => ({ ...a }));
      setAttr(attrs, "src", image.src);
      setAttr(attrs, "srcset", image.srcset || null);
      setAttr(attrs, "width", image.width);
      setAttr(attrs, "height", image.height);
      setAttr(attrs, "alt", image.alt ?? "");
      ops.push({ ...region.startTag, text: buildStartTag(region.tag, attrs) });
    } else if (region.kind === "image-link") {
      const attrs = region.el.attrs.map((a) => ({ ...a }));
      setAttr(attrs, "href", image.photoId ? `#${image.photoId}` : "#gallery");
      ops.push({ ...region.startTag, text: buildStartTag(region.tag, attrs) });
    } else if (region.kind === "image-hex" && image.color) {
      const attrs = region.el.attrs.map((a) => ({ ...a }));
      setAttr(attrs, "style", `--swatch:${image.color}`);
      ops.push({ ...region.startTag, text: buildStartTag(region.tag, attrs) });
      ops.push({ ...region.inner, text: image.color.toUpperCase() });
    }
  }

  ops.sort((a, b) => b.start - a.start);
  for (let i = 1; i < ops.length; i++) {
    if (ops[i].end > ops[i - 1].start) throw new Error("Overlapping edits");
  }
  let out = html;
  for (const op of ops) out = out.slice(0, op.start) + op.text + out.slice(op.end);
  return out;
}
