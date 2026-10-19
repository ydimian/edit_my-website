// Tests for site-model.js against the real site files.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contrast } from "../public/shared/palette.js";
import { readModel, applyChange, parsePhotoData, serializePhotoData, READ_FILES, PHOTO_DATA } from "../src/site-model.js";

import { SITE, siteTest as test } from "./site.mjs";
const files = () => Object.fromEntries(READ_FILES.map((p) => [p, readFileSync(new URL(p, SITE), "utf8")]));

test("photo data parses and re-serializes byte-identically", () => {
  const src = files()[PHOTO_DATA];
  const data = parsePhotoData(src);
  assert.ok(data.categories.length >= 1 && data.items.length >= 1);
  assert.equal(serializePhotoData(src, data), src);
});

test("model reads fields, images, photos and theme", () => {
  const m = readModel(files());
  assert.ok(m.fields.length > 200);
  assert.deepEqual(m.images.map((i) => i.slot).sort(), ["about.portrait", "photography.hero", "photography.print"]);
  const footer = m.fields.find((f) => f.key === "footer.tagline");
  assert.deepEqual(footer.pages, ["index.html", "photography.html"]);
  assert.equal(m.theme.defaults.accent, "#ef6a3f");
});

test("an empty save changes nothing", () => {
  const r = applyChange(files(), {});
  assert.deepEqual(r.changed, {});
  assert.deepEqual(r.deletes, []);
});

test("shared footer text is written to both pages", () => {
  const r = applyChange(files(), { fields: { "footer.tagline": { value: "Hello\n*there*" } } });
  assert.deepEqual(Object.keys(r.changed).sort(), ["index.html", "photography.html"]);
  for (const html of Object.values(r.changed)) assert.ok(html.includes('data-edit="footer.tagline">Hello<br><em>there</em></p>'));
});

test("per-text colour: the light value is always derived on the server", () => {
  const r = applyChange(files(), { fields: { "contact.heading": { color: { dark: "#3fd0c9", light: "#ffffff" } } } });
  const light = r.changed["index.html"].match(/--tc-dark:#3fd0c9; --tc-light:(#[0-9a-f]{6})/)?.[1];
  assert.ok(light && light !== "#ffffff", "the browser's light value is ignored");
  assert.ok(contrast(light, "#f3f0e8") >= 4.5, `derived ${light} is readable on the light background`);
});

test("removing a photo deletes its files; adding one requires its files", () => {
  const f = files();
  const { categories, items } = parsePhotoData(f[PHOTO_DATA]);
  const removed = items.find((p) => !p.featured);
  const added = { ...items[0], id: "new-shot", title: "New" };
  const r = applyChange(f, { photos: { categories, items: [added, ...items.filter((p) => p !== removed)] } });
  assert.deepEqual(r.deletes.sort(), [`assets/photos/${removed.id}-900.webp`, `assets/photos/${removed.id}.webp`]);
  assert.ok(r.required.includes("assets/photos/new-shot.webp") && r.required.includes("assets/photos/new-shot-900.webp"));
});

test("bad input is rejected", () => {
  const f = files();
  assert.throws(() => applyChange(f, { fields: { "nope.key": { value: "x" } } }), /Unknown field/);
  assert.throws(() => applyChange(f, { uploads: [{ path: "index.html", sha: "a".repeat(40) }] }), /Uploads must be photos/);
  assert.throws(() => applyChange(f, { uploads: [{ path: "assets/photos/../x.webp", sha: "a".repeat(40) }] }), /Uploads must be photos/);
  assert.throws(() => applyChange(f, { images: { "photography.hero": { src: "https://evil.example/x.webp", width: 1, height: 1 } } }), /assets\/photos/);
  assert.throws(() => applyChange(f, { theme: { choices: { accent: "red; } body { display:none" } } }), /hex/);
  assert.throws(() => applyChange(f, { fields: { "contact.heading": { color: { dark: "url(x)" } } } }), /hex/);
});
