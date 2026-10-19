/**
 * markup.js — the small text format used for formatted text in the editor.
 *
 *   *italic*        <->  <em>italic</em>
 *   **bold**        <->  <strong>bold</strong>
 *   ==highlight==   <->  <em class="accent">highlight</em>   (accent colour)
 *   a new line      <->  <br>
 *   \*  \=          ->   a literal * or =
 *
 * Shared by the editor UI (live preview) and the Worker (writing the site's
 * HTML), so both always produce exactly the same HTML.
 */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };

export function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name) => {
    if (name[0] === "#") {
      const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[name.toLowerCase()] ?? match;
  });
}

/** Markup text -> HTML. */
export function markupToHtml(markup) {
  const ESC_STAR = "\u0001";
  const ESC_EQ = "\u0002";
  let s = String(markup ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\\\*/g, ESC_STAR)
    .replace(/\\=/g, ESC_EQ);
  s = escapeHtml(s)
    .replace(/==([^\n]+?)==/g, '<em class="accent">$1</em>')
    .replace(/\*\*([^\n]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^\n]+?)\*/g, "<em>$1</em>")
    .replace(/\n/g, "<br>");
  return s.replace(new RegExp(ESC_STAR, "g"), "*").replace(new RegExp(ESC_EQ, "g"), "=");
}

/**
 * HTML -> markup text, or null if the HTML uses anything the markup can't
 * express (then the editor offers the raw HTML instead).
 */
export function htmlToMarkup(html) {
  const source = String(html ?? "").replace(/\s+/g, " ").trim();
  const parts = source.split(/(<[^>]*>)/);
  const open = []; // stack of markers for the currently open tags
  let out = "";

  for (const part of parts) {
    if (!part) continue;
    if (part[0] !== "<") {
      out += decodeEntities(part).replace(/\\/g, "\\\\").replace(/\*/g, "\\*").replace(/==/g, "\\=\\=");
      continue;
    }
    if (/^<br\s*\/?>$/i.test(part)) {
      out = out.replace(/ $/, "") + "\n";
      continue;
    }
    if (/^<em\s+class=["']accent["']\s*>$/i.test(part)) { open.push("=="); out += "=="; continue; }
    if (/^<(em|i)>$/i.test(part)) { open.push("*"); out += "*"; continue; }
    if (/^<(strong|b)>$/i.test(part)) { open.push("**"); out += "**"; continue; }
    if (/^<\/(em|i|strong|b)>$/i.test(part) && open.length) { out += open.pop(); continue; }
    return null; // a tag the markup can't represent
  }
  if (open.length) return null;
  return out.replace(/\n /g, "\n").trim();
}

/** Plain text (no formatting at all), e.g. for the browser-tab title. */
export function textToHtml(text) {
  return escapeHtml(String(text ?? "").replace(/\s+/g, " ").trim());
}

export function htmlToText(html) {
  return decodeEntities(String(html ?? "").replace(/\s+/g, " ").trim());
}
