/**
 * theme.js — the site's editable colours and how theme.css is generated.
 *
 * You choose dark-mode colours; light-mode ones are derived (palette.js).
 * Only colours you've changed are written, so untouched ones keep the
 * hand-tuned values in base.css. Your choices are stored as JSON in a
 * comment at the top of theme.css ("editor-theme {...}") so the editor can
 * read them back.
 */
import { deriveLight, withAlpha, isHex, DEFAULT_LIGHT_BG } from "./palette.js";

export const THEME_TOKENS = [
  { id: "bg", css: "--bg", role: "bg", label: "Background", hint: "Page background" },
  { id: "bg2", css: "--bg-2", role: "bg2", label: "Background, alternate", hint: "Project art, diagrams" },
  { id: "surface", css: "--surface", role: "surface", label: "Cards & panels", hint: "Project cards, popups" },
  { id: "ink", css: "--ink", role: "ink", label: "Text", hint: "Headings and main text; also tints lines and borders" },
  { id: "ink2", css: "--ink-2", role: "ink2", label: "Secondary text", hint: "Paragraphs" },
  { id: "ink3", css: "--ink-3", role: "ink3", label: "Muted text", hint: "Labels, captions, small print" },
  { id: "accent", css: "--accent", role: "accent", label: "Accent", hint: "Highlights, buttons on hover, links" },
  { id: "gold", css: "--logo-gold", role: "gold", label: "Logo gold", hint: "Inner part of the logo" },
];

const MARK = "editor-theme ";

/** Read the saved dark-mode choices from theme.css. */
export function readThemeChoices(css) {
  const line = String(css || "").split("\n").find((l) => l.includes(MARK));
  if (!line) return {};
  try {
    const json = JSON.parse(line.slice(line.indexOf(MARK) + MARK.length).trim());
    return Object.fromEntries(Object.entries(json).filter(([id, v]) => THEME_TOKENS.some((t) => t.id === id) && isHex(v)));
  } catch {
    return {};
  }
}

/** Default dark-mode values, read from base.css. */
export function readDarkDefaults(baseCss) {
  return readTokens(String(baseCss).match(/:root\[data-theme="dark"\],\s*\.tone-dark\s*\{([^}]*)\}/)?.[1]);
}

/** Default light-mode values (base.css's hand-tuned :root block), shown for colours you haven't changed. */
export function readLightDefaults(baseCss) {
  return readTokens(String(baseCss).match(/(?:^|\n):root\s*\{([^}]*)\}/)?.[1]);
}

function readTokens(block = "") {
  const out = {};
  for (const t of THEME_TOKENS) {
    const m = block.match(new RegExp(`${t.css}\\s*:\\s*(#[0-9a-fA-F]{3,6})`));
    if (m) out[t.id] = m[1].toLowerCase();
  }
  return out;
}

/** For each changed token: its dark value and derived light value (plus helper vars). */
export function resolveTheme(choices) {
  const lightBg = choices.bg ? deriveLight("bg", choices.bg) : DEFAULT_LIGHT_BG;
  const dark = {};
  const light = {};
  for (const t of THEME_TOKENS) {
    const value = choices[t.id];
    if (!isHex(value)) continue;
    dark[t.css] = value.toLowerCase();
    light[t.css] = deriveLight(t.role, value, lightBg);
  }
  if (choices.ink) {
    const d = dark["--ink"], l = light["--ink"];
    Object.assign(dark, {
      "--line": withAlpha(d, 0.1), "--line-2": withAlpha(d, 0.2), "--grid": withAlpha(d, 0.05),
      "--trace": withAlpha(d, 0.13), "--trace-strong": withAlpha(d, 0.3),
    });
    Object.assign(light, {
      "--line": withAlpha(l, 0.12), "--line-2": withAlpha(l, 0.22), "--grid": withAlpha(l, 0.06),
      "--trace": withAlpha(l, 0.16), "--trace-strong": withAlpha(l, 0.34),
    });
  }
  if (choices.accent) {
    dark["--accent-soft"] = withAlpha(dark["--accent"], 0.15);
    light["--accent-soft"] = withAlpha(light["--accent"], 0.13);
  }
  return { dark, light };
}

const block = (selector, vars, indent = "") => {
  const lines = Object.entries(vars).map(([k, v]) => `${indent}  ${k}: ${v};`);
  return lines.length ? `${indent}${selector} {\n${lines.join("\n")}\n${indent}}\n` : "";
};

/** The complete theme.css for a set of dark-mode choices. */
export function buildThemeCss(choices = {}) {
  const clean = Object.fromEntries(Object.entries(choices).filter(([id, v]) => THEME_TOKENS.some((t) => t.id === id) && isHex(v)));
  const { dark, light } = resolveTheme(clean);
  let css = `/* ==========================================================================
   theme.css — written by the site editor (edit.youhannad.com).
   Dark-mode colours are picked in the editor; light-mode ones are derived
   from them automatically. Loaded last, so it overrides base.css.
   ${MARK}${JSON.stringify(clean)}
   ========================================================================== */

/* Per-text colours chosen in the editor (data-color + --tc-dark / --tc-light) */
[data-color][data-color] { color: var(--tc-light); }
:root[data-theme="dark"] [data-color][data-color],
.tone-dark [data-color][data-color] { color: var(--tc-dark); }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) [data-color][data-color] { color: var(--tc-dark); }
}
`;
  if (Object.keys(dark).length) {
    css += "\n/* Theme colours */\n";
    css += block(":root", light);
    css += block(':root[data-theme="dark"],\n.tone-dark', dark);
    css += `@media (prefers-color-scheme: dark) {\n${block(":root:not([data-theme])", dark, "  ")}}\n`;
  }
  return css;
}
