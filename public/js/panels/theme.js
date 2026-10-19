/**
 * panels/theme.js — the site's colours.
 *
 * You pick each colour for dark mode; its light-mode counterpart is derived
 * (same hue, lightness and contrast adjusted for the light background) and
 * shown next to it. Colours you haven't changed keep the original,
 * hand-tuned light values.
 */
import { store } from "../store.js";
import { preview } from "../preview.js";
import { h, $ } from "../dom.js";
import { THEME_TOKENS, resolveTheme } from "/shared/theme.js";
import { contrast } from "/shared/palette.js";

const root = $("#panel-theme");
const rows = new Map(); // token id -> { el, input, lightBox, lightLabel, ratio, reset }

// What each colour's contrast number measures, and the minimum that reads well
const CHECK = {
  bg: { fg: "ink", min: 4.5 }, bg2: { fg: "ink", min: 4.5 }, surface: { fg: "ink", min: 4.5 },
  ink: { bg: "bg", min: 4.5 }, ink2: { bg: "bg", min: 4.5 }, ink3: { bg: "bg", min: 3 },
  accent: { bg: "bg", min: 3 }, gold: { bg: "bg", min: 3 },
};

export function renderTheme() {
  rows.clear();
  root.replaceChildren(
    h("h2", { text: "Colours" }),
    h("p", { class: "lede" }, "Pick the dark-mode colours. The light-mode version of each is generated for you: same hue, adjusted to read well on a light background. Use Dark / Light above the preview to check both."),
    h("div", { class: "toolbar" },
      h("button", { class: "btn btn--sm", type: "button", onclick: () => { store.resetTheme(); renderTheme(); preview.theme(); } }, "Reset all to original")),
    h("div", { class: "tokens" }, THEME_TOKENS.map(renderRow)),
    h("p", { class: "fld__hint", style: { marginTop: "14px" } },
      "The numbers are contrast ratios in dark / light mode (text against the background). 4.5 or more reads comfortably; amber means it may be hard to read. ",
      "To colour a single piece of text, use the swatch next to it in the Text tab."),
  );
  refresh();
}

function renderRow(token) {
  const input = h("input", {
    type: "color", "aria-label": `${token.label}, dark mode`,
    oninput: (e) => { store.setThemeChoice(token.id, e.target.value); preview.theme(); refresh(); },
  });
  const lightBox = h("span", { class: "chipsw__box" });
  const lightLabel = h("span", { class: "chipsw__label", text: "Light" });
  const ratio = h("span", { class: "ratio" });
  const reset = h("button", { class: "link-btn", type: "button", onclick: () => { store.setThemeChoice(token.id, null); preview.theme(); refresh(); } }, "Reset");

  const el = h("div", { class: "card token" },
    h("div", {},
      h("div", { class: "token__name", text: token.label }),
      h("div", { class: "token__hint", text: token.hint }),
      reset),
    h("div", { class: "token__pair" },
      h("label", { class: "chipsw", title: "Click to change (dark mode)" }, h("span", { class: "chipsw__box" }, input), h("span", { class: "chipsw__label", text: "Dark" })),
      h("span", { class: "arrow", "aria-hidden": "true", text: "→" }),
      h("div", { class: "chipsw", title: "Generated for light mode" }, lightBox, lightLabel)),
    ratio,
  );
  rows.set(token.id, { el, input, lightBox, ratio, reset });
  return el;
}

/** Current dark and light value of every colour. */
function currentColours() {
  const { defaults, lightDefaults = {} } = store.loaded.model.theme;
  const choices = store.themeChoices();
  const derived = resolveTheme(choices);
  const out = {};
  for (const t of THEME_TOKENS) {
    out[t.id] = {
      dark: choices[t.id] || defaults[t.id],
      light: derived.light[t.css] || lightDefaults[t.id] || defaults[t.id],
      changed: Boolean(choices[t.id]),
    };
  }
  return out;
}

function refresh() {
  const colours = currentColours();
  const saved = store.loaded.model.theme.choices;
  for (const t of THEME_TOKENS) {
    const row = rows.get(t.id);
    if (!row) continue;
    const c = colours[t.id];
    if (document.activeElement !== row.input) row.input.value = c.dark;
    row.lightBox.style.background = c.light;
    row.lightBox.title = c.light;
    row.reset.hidden = !c.changed;
    row.el.classList.toggle("is-changed", (store.themeChoices()[t.id] || null) !== (saved[t.id] || null));

    const check = CHECK[t.id];
    const pair = (mode) => check.fg
      ? contrast(colours[check.fg][mode], c[mode])
      : contrast(c[mode], colours[check.bg][mode]);
    const d = pair("dark"), l = pair("light");
    row.ratio.textContent = `${d.toFixed(1)} / ${l.toFixed(1)}`;
    row.ratio.title = check.fg ? "Contrast of text on this colour (dark / light)" : "Contrast against the background (dark / light)";
    row.ratio.classList.toggle("is-low", Math.min(d, l) < check.min);
  }
}
