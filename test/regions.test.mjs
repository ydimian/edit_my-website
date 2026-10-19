// Tests for html-regions.js against the real site pages (../index.html etc.).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { scanRegions, readRegion, applyEdits } from "../src/html-regions.js";

import { SITE, siteTest } from "./site.mjs";
const PAGES = ["index.html", "photography.html"].filter((p) => existsSync(new URL(p, SITE)));
const load = (p) => readFileSync(new URL(p, SITE), "utf8");
const norm = (s) => s.replace(/\s+/g, " ").trim();

siteTest("site pages are present", () => assert.ok(PAGES.length === 2, "index.html and photography.html"));

for (const page of PAGES) {
  test(`${page}: every region reads as text/list/plain/image (no raw-HTML fallbacks)`, () => {
    const html = load(page);
    const regions = scanRegions(html);
    assert.ok(regions.length > 30);
    const odd = regions.filter((r) => r.kind === "html").map((r) => r.key);
    assert.deepEqual(odd, [], `regions falling back to raw HTML: ${odd.join(", ")}`);
    for (const r of regions) {
      const { value } = readRegion(r, html);
      if (r.kind === "text" || r.kind === "plain") assert.equal(typeof value, "string", r.key);
      if (r.kind === "list") assert.ok(Array.isArray(value) && value.length > 0, r.key);
    }
  });

  test(`${page}: no edits -> byte-identical output`, () => {
    const html = load(page);
    assert.equal(applyEdits(html, {}), html);
  });

  test(`${page}: writing every field back with its own value keeps the content`, () => {
    const html = load(page);
    const regions = scanRegions(html).filter((r) => r.marker === "data-edit");
    const edits = new Map(regions.map((r) => [r.key, { value: readRegion(r, html).value }]));
    const out = applyEdits(html, { edits });
    const after = new Map(scanRegions(out).filter((r) => r.marker === "data-edit").map((r) => [r.key, r]));
    for (const r of regions) {
      const a = norm(html.slice(r.inner.start, r.inner.end));
      const b = norm(out.slice(after.get(r.key).inner.start, after.get(r.key).inner.end));
      assert.equal(b.replace(/> </g, "><"), a.replace(/> </g, "><"), r.key);
    }
  });
}

siteTest("editing one field changes only that field", () => {
  const html = load("index.html");
  const out = applyEdits(html, { edits: new Map([["hero.heading-1", { value: "Chips & *Circuits.*" }]]) });
  assert.ok(out.includes('data-edit="hero.heading-1">Chips &amp; <em>Circuits.</em></span>'));
  const diff = [...out].length - [...html].length;
  assert.ok(Math.abs(diff) < 40);
  // everything outside the region is untouched
  const r = scanRegions(html).find((x) => x.key === "hero.heading-1");
  assert.equal(out.slice(0, r.inner.start), html.slice(0, r.inner.start));
});

siteTest("lists: items can be edited, added and removed, keeping the item markup", () => {
  const html = load("index.html");
  const key = "experience.skyjack.skills";
  const out = applyEdits(html, { edits: new Map([[key, { value: ["CAN", "Python", "New skill"] }]]) });
  const r = scanRegions(out).find((x) => x.key === key);
  assert.deepEqual(readRegion(r, out).value, ["CAN", "Python", "New skill"]);
  assert.ok(out.includes('<li class="chip">New skill</li>'));
});

siteTest("per-text colour: set, change and clear", () => {
  const html = load("index.html");
  const key = "contact.heading";
  const set = applyEdits(html, { edits: new Map([[key, { color: { dark: "#7fbf9a", light: "#2c8556" } }]]) });
  let r = scanRegions(set).find((x) => x.key === key);
  assert.deepEqual(readRegion(r, set).color, { dark: "#7fbf9a", light: "#2c8556" });
  const cleared = applyEdits(set, { edits: new Map([[key, { color: null }]]) });
  r = scanRegions(cleared).find((x) => x.key === key);
  assert.equal(readRegion(r, cleared).color, null);
  assert.equal(cleared, html, "clearing the colour restores the original tag");
});

siteTest("existing style attributes survive a colour change", () => {
  const html = load("index.html");
  const key = "hero.heading-1"; // has style="--i:0"
  const out = applyEdits(html, { edits: new Map([[key, { color: { dark: "#ffffff", light: "#000000" } }]]) });
  assert.match(out, /style="--i:0; --tc-dark:#ffffff; --tc-light:#000000" data-edit="hero.heading-1" data-color/);
});

siteTest("image slots: swap the picture and update its link and colour swatch", () => {
  const html = load("photography.html");
  const images = new Map([["photography.hero", {
    src: "assets/photos/rainier-falls.webp", srcset: "assets/photos/rainier-falls-900.webp 600w, assets/photos/rainier-falls.webp 1467w",
    width: 1467, height: 2200, alt: "A waterfall", photoId: "rainier-falls", color: "#53636f",
  }]]);
  const out = applyEdits(html, { images });
  assert.match(out, /<img class="ph-hero__img" src="assets\/photos\/rainier-falls\.webp" srcset="[^"]+" sizes="100vw" width="1467" height="2200"/);
  assert.match(out, /href="#rainier-falls"/);
  assert.match(out, /style="--swatch:#53636f" data-edit-img-hex="photography.hero">#53636F</);
});

siteTest("the page title is plain text", () => {
  const html = load("photography.html");
  const out = applyEdits(html, { edits: new Map([["page.photography-title", { value: "Frames & <Light>" }]]) });
  assert.ok(out.includes('<title data-edit="page.photography-title">Frames &amp; &lt;Light&gt;</title>'));
});
