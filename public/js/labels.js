/**
 * labels.js — turn field keys like "projects.spi.case.design" into readable
 * labels and groups ("Home · Projects" › "SPI-controlled PWM peripheral" ›
 * "Case study · Design").
 */
export const GROUPS = [
  ["hero", "Home · Intro"],
  ["about", "Home · About"],
  ["skills", "Home · Technical skills"],
  ["projects", "Home · Projects"],
  ["experience", "Home · Experience"],
  ["photo-band", "Home · Photography teaser"],
  ["contact", "Home · Contact"],
  ["photography", "Photography page"],
  ["footer", "Footer · both pages"],
  ["page", "Browser tab titles"],
];
const GROUP_LABEL = Object.fromEntries(GROUPS);
const NAMED_SUBS = { "photography.hero": "Header", "photography.prints": "Prints", "photography.lightbox": "Photo viewer", "contact.form": "Contact form" };

const LEAF = {
  title: "Title", subtitle: "Note beside the title", heading: "Heading", "heading-1": "Heading · line 1", "heading-2": "Heading · line 2",
  "title-1": "Title · line 1", "title-2": "Title · line 2", intro: "Intro", status: "Status pill", "figure-label": "Small figure label",
  button: "Button", label: "Label", meta: "Tools line", summary: "Summary", constraint: "Constraint", "constraint-label": "Constraint · label",
  solution: "Solution", "solution-label": "Solution · label", "layout-link": "Layout link", "layout-caption": "Layout caption",
  badge: "Badge", dates: "Dates", note: "Note", role: "Role", org: "Organisation", "org-note": "Organisation · note",
  description: "Description", bullets: "Bullet points · one per line", skills: "Skills · one per line", name: "Name", items: "Skills",
  caption: "Caption", "portrait-focal": "Portrait · focal length", "portrait-exposure": "Portrait · exposure", "portrait-caption": "Portrait · caption",
  text: "Text", eyebrow: "Small line above the title", settings: "Camera settings", "scroll-label": "Scroll link", hint: "Keyboard hint",
  "sensor-note": "Sensor view explanation", "sensor-button": "Sensor view button", "print-button": "Print button", signature: "Signature",
  tagline: "Tagline", wordmark: "Big name", credit: "Credit line", "back-to-top": "Back-to-top link", "home-title": "Home page",
  "photography-title": "Photography page", question: "Question", "name-label": "Name label", "email-label": "Email label",
  "message-label": "Message label", "resume-button": "Résumé button", "case.tagline": "Case study · top line", "case.title": "Case study · title",
  "case.lead": "Case study · intro", "case.figure-caption": "Case study · diagram caption", "case.stack": "Case study · tools · one per line",
};

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const humanize = (s) => cap(s.replace(/-/g, " "));

function leafLabel(rest) {
  if (LEAF[rest]) return LEAF[rest];
  let m;
  if ((m = rest.match(/^(stat|fact|option|link|button|paragraph)-(\d+)(-label)?$/))) return `${humanize(m[1])} ${m[2]}${m[3] ? " · label" : ""}`;
  if ((m = rest.match(/^case\.(.+)-heading$/))) return `Case study · ${humanize(m[1])} · heading`;
  if ((m = rest.match(/^case\.link-(\d+)$/))) return `Case study · button ${m[1]}`;
  if ((m = rest.match(/^case\.(.+)$/))) return `Case study · ${humanize(m[1])}`;
  if ((m = rest.match(/^(navigate|elsewhere)-(.+)$/))) return m[2] === "heading" ? `${humanize(m[1])} · heading` : `${humanize(m[1])} · ${humanize(m[2])} link`;
  return rest.split(".").map(humanize).join(" · ");
}

const plain = (v) => String(Array.isArray(v) ? v[0] : v ?? "").replace(/\\([*=])/g, "$1").replace(/[*=]{1,2}/g, "").replace(/\n/g, " ").trim();

/**
 * { group, groupLabel, sub, subLabel, label } for a field key.
 * valueOf(key) looks up current values, used to name sub-groups (e.g. a project by its title).
 */
export function describeKey(key, valueOf) {
  const parts = key.split(".");
  const group = parts[0];
  const hasSub = parts.length >= 3 && group !== "page";
  const sub = hasSub ? `${group}.${parts[1]}` : null;
  const rest = parts.slice(hasSub ? 2 : 1).join(".");
  let subLabel = null;
  if (sub) {
    subLabel = NAMED_SUBS[sub]
      || (group === "projects" && plain(valueOf(`${sub}.title`)))
      || (group === "experience" && [plain(valueOf(`${sub}.role`)), plain(valueOf(`${sub}.org`))].filter(Boolean).join(" · "))
      || (group === "skills" && plain(valueOf(`${sub}.name`)))
      || humanize(parts[1]);
  }
  return { group, groupLabel: GROUP_LABEL[group] || humanize(group), sub, subLabel, label: leafLabel(rest) };
}

export const pageLabel = (pages) => (pages.length > 1 ? "Both pages" : pages[0] === "photography.html" ? "Photography" : "Home");
