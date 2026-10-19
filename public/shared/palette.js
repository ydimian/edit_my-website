/**
 * palette.js — derive light-mode colours from dark-mode ones.
 *
 * You pick colours for the dark theme; each light-mode counterpart keeps the
 * same hue and character but gets a lightness (and contrast) that works on a
 * light background. Works in OKLCH, a colour space where "lightness" matches
 * what the eye sees, so the derived colours look like the same family.
 *
 * Shared by the editor UI (swatches, live preview) and the Worker (writing
 * theme.css).
 */

/* ---------- Conversions: hex <-> sRGB <-> OKLab <-> OKLCH ---------- */

export function hexToRgb(hex) {
  let h = String(hex).trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`Not a hex colour: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

export function rgbToHex([r, g, b]) {
  const to = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function rgbToOklab([r, g, b]) {
  const [lr, lg, lb] = [r, g, b].map(toLinear);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinearRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function hexToOklch(hex) {
  const [L, a, b] = rgbToOklab(hexToRgb(hex));
  const C = Math.hypot(a, b);
  const H = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return { L, C, H };
}

/** OKLCH -> hex, reducing chroma until the colour fits in sRGB. */
export function oklchToHex({ L, C, H }) {
  const h = (H * Math.PI) / 180;
  let c = C;
  for (let i = 0; i < 40; i++) {
    const lin = oklabToLinearRgb([L, c * Math.cos(h), c * Math.sin(h)]);
    if (lin.every((v) => v >= -0.0005 && v <= 1.0005) || c < 1e-4) return rgbToHex(lin.map(toGamma));
    c *= 0.92;
  }
  return rgbToHex(oklabToLinearRgb([L, 0, 0]).map(toGamma));
}

/* ---------- Contrast (WCAG 2) ---------- */

export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/* ---------- Light-mode derivation ---------- */

// Lightness of each neutral role in the original light theme, and how much
// of the dark colour's chroma (tint) carries over.
const NEUTRAL_ROLES = {
  bg: { L: 0.955, chroma: 2.8, cap: 0.03 },
  bg2: { L: 0.926, chroma: 2.8, cap: 0.03 },
  surface: { L: 0.98, chroma: 1, cap: 0.02 },
  ink: { L: 0.2, chroma: 1, cap: 0.06 },
  ink2: { L: 0.415, chroma: 1, cap: 0.06 },
  ink3: { L: 0.6, chroma: 1, cap: 0.06 },
};

// Minimum contrast against the light background for coloured roles.
const ACCENT_ROLES = { accent: 3.5, gold: 3.5, text: 4.5 };

export const DEFAULT_LIGHT_BG = "#f3f0e8";

/**
 * Light-mode counterpart of `darkHex` for a role:
 * bg | bg2 | surface | ink | ink2 | ink3 | accent | gold | text.
 */
export function deriveLight(role, darkHex, lightBg = DEFAULT_LIGHT_BG) {
  const { L, C, H } = hexToOklch(darkHex);

  if (NEUTRAL_ROLES[role]) {
    const r = NEUTRAL_ROLES[role];
    return oklchToHex({ L: r.L, C: Math.min(C * r.chroma, r.cap), H });
  }

  const min = ACCENT_ROLES[role] ?? 4.5;
  let l = Math.min(L, 0.66);
  let hex = oklchToHex({ L: l, C, H });
  while (contrast(hex, lightBg) < min && l > 0.05) {
    l -= 0.01;
    hex = oklchToHex({ L: l, C, H });
  }
  return hex;
}

/** `#rrggbb` + alpha -> `rgba(r, g, b, a)`. */
export function withAlpha(hex, alpha) {
  const [r, g, b] = hexToRgb(hex).map((v) => Math.round(v * 255));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const isHex = (v) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(v ?? "").trim());
