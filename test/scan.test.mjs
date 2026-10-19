// html-scan.js must find the same elements, at the same offsets, as a full
// HTML parser (parse5) does on the real site pages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { parse } from "parse5";
import { scanHtml } from "../src/html-scan.js";

import { SITE } from "./site.mjs";
const PAGES = ["index.html", "photography.html", "404.html"].filter((p) => existsSync(new URL(p, SITE)));

function* walkParse5(node) {
  yield node;
  for (const child of node.childNodes || []) yield* walkParse5(child);
  if (node.content) yield* walkParse5(node.content);
}
function* walkScan(node) {
  yield node;
  for (const child of node.children) yield* walkScan(child);
}

/** Every element written in the source, keyed by where its start tag begins. */
function viaParse5(html) {
  const out = new Map();
  for (const el of walkParse5(parse(html, { sourceCodeLocationInfo: true }))) {
    const loc = el.sourceCodeLocation;
    if (!el.tagName || !loc?.startTag) continue;
    out.set(loc.startTag.startOffset, {
      tag: el.tagName,
      startTagEnd: loc.startTag.endOffset,
      endTag: loc.endTag ? [loc.endTag.startOffset, loc.endTag.endOffset] : null,
      attrs: el.attrs.map((a) => `${a.prefix ? `${a.prefix}:` : ""}${a.name}=${a.value}`),
    });
  }
  return out;
}

function viaScan(html) {
  const out = new Map();
  for (const el of walkScan(scanHtml(html))) {
    if (!el.startTag) continue;
    out.set(el.startTag.start, {
      tag: el.tag,
      startTagEnd: el.startTag.end,
      endTag: el.endTag ? [el.endTag.start, el.endTag.end] : null,
      attrs: el.attrs.map((a) => `${a.name}=${a.value}`),
    });
  }
  return out;
}

function compare(html) {
  const expected = viaParse5(html);
  const actual = viaScan(html);
  for (const [offset, want] of expected) {
    const got = actual.get(offset);
    const where = `<${want.tag}> at ${offset}: ${html.slice(offset, offset + 60).replace(/\s+/g, " ")}`;
    assert.ok(got, `missing ${where}`);
    // parse5 keeps SVG's camelCase names (viewBox, linearGradient); compare case-insensitively
    assert.equal(got.tag, want.tag.toLowerCase(), where);
    assert.equal(got.startTagEnd, want.startTagEnd, where);
    assert.deepEqual(got.endTag, want.endTag, where);
    assert.deepEqual(got.attrs, want.attrs.map((a) => a.replace(/^[^=]+/, (n) => n.toLowerCase())), where);
  }
  assert.equal(actual.size, expected.size, "same number of elements");
}

for (const page of PAGES) {
  test(`${page}: same elements and offsets as parse5`, () => compare(readFileSync(new URL(page, SITE), "utf8")));
}

test("edge cases: comments, raw text, void, self-closing, implied ends, quoting", () => {
  compare(`<!doctype html><html><head><title>A <b> &amp; title</title>
<style>p > a { color: red }</style><script>if (a < b && "</div>") {}</script></head>
<body><!-- <p data-edit="x">not real</p> -->
<p class=lead data-edit='a'>One &amp; <em>two</em><br>three</p>
<ul data-edit="list"><li>a<li>b</li>
<li class="x">c</li></ul>
<img src="a.webp" alt="1 > 0" width=10><svg viewBox="0 0 1 1"><path d="M0 0"/><circle r="1" /></svg>
<select><option>a<option selected>b</select><textarea data-edit="t"><b>raw</b></textarea>
<a href="#" title="x"data-edit="y">link</a></body></html>`);
});
