import { test } from "node:test";
import assert from "node:assert/strict";
import { markupToHtml, htmlToMarkup } from "../public/shared/markup.js";
import { deriveLight, contrast, oklchToHex, hexToOklch } from "../public/shared/palette.js";

test("markup -> html", () => {
  assert.equal(markupToHtml("Silicon & *Logic.*"), "Silicon &amp; <em>Logic.</em>");
  assert.equal(markupToHtml("I’m **Youhanna**"), "I’m <strong>Youhanna</strong>");
  assert.equal(markupToHtml("Photography & ==Light.=="), 'Photography &amp; <em class="accent">Light.</em>');
  assert.equal(markupToHtml("Selected\n*Frames*"), "Selected<br><em>Frames</em>");
  assert.equal(markupToHtml("5 \\* 3 and a \\= b"), "5 * 3 and a = b");
  assert.equal(markupToHtml("<script>"), "&lt;script&gt;");
});

test("html -> markup", () => {
  assert.equal(htmlToMarkup("Silicon &amp; <em>Logic.</em>"), "Silicon & *Logic.*");
  assert.equal(htmlToMarkup('Photography &amp; <em class="accent">Light.</em>'), "Photography & ==Light.==");
  assert.equal(htmlToMarkup("Selected<br><em>Frames</em>"), "Selected\n*Frames*");
  assert.equal(htmlToMarkup("\n  I’m <strong>Y</strong>,\n  hi.\n"), "I’m **Y**, hi.");
  assert.equal(htmlToMarkup("R/W = 1 · count &lt; duty"), "R/W = 1 · count < duty");
  assert.equal(htmlToMarkup('a <span class="x">b</span>'), null, "unsupported tags are refused");
});

test("markup round-trips", () => {
  for (const s of ["Plain", "a *b* c", "**bold** and ==hi==", "two\nlines", "literal \\* star", "x \\=\\= y? use \\=\\="]) {
    assert.equal(htmlToMarkup(markupToHtml(s)), s, s);
  }
});

test("palette: light colours stay readable and keep their hue", () => {
  for (const dark of ["#ef6a3f", "#3fd0c9", "#c2a67d", "#9b8cff", "#ffd400"]) {
    const light = deriveLight("accent", dark);
    assert.ok(contrast(light, "#f3f0e8") >= 3.5, `${dark} -> ${light}`);
    const dh = hexToOklch(dark).H, lh = hexToOklch(light).H;
    assert.ok(Math.min(Math.abs(dh - lh), 360 - Math.abs(dh - lh)) < 12, `hue drift ${dark} -> ${light}`);
  }
  assert.ok(contrast(deriveLight("text", "#ffd400"), "#f3f0e8") >= 4.5);
  assert.equal(oklchToHex(hexToOklch("#123456")), "#123456");
});
