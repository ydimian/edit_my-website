/**
 * preview.js — serve the draft branch so it can be previewed privately.
 *
 *   /preview/<commit-sha>/index.html   the site exactly as saved in that commit
 *   /preview/latest/                   redirects to the current draft commit
 *
 * Putting the commit in the path means every file a page loads (CSS, JS,
 * photos) comes from the same commit, and responses can be cached forever.
 * HTML pages get a small "bridge" script so the editor can show unsaved
 * edits live and highlight what you're editing.
 */

const TYPES = {
  html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8", json: "application/json", svg: "image/svg+xml", webp: "image/webp",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", ico: "image/x-icon", pdf: "application/pdf",
  txt: "text/plain; charset=utf-8", woff2: "font/woff2",
};

const BRIDGE = '<script type="module" src="/preview-bridge.js"></script>';

export async function servePreview(request, url, repo) {
  const match = url.pathname.match(/^\/preview\/([0-9a-f]{40}|latest)(\/.*)?$/);
  if (!match) return new Response("Not found", { status: 404 });
  let [, sha, rest = "/"] = match;

  if (sha === "latest") {
    const { draftSha } = await repo.syncDraft();
    return Response.redirect(new URL(`/preview/${draftSha}${rest === "/" ? "/index.html" : rest}${url.search}`, url).toString(), 302);
  }

  let path = decodeURIComponent(rest.replace(/^\/+/, "")) || "index.html";
  if (path.endsWith("/")) path += "index.html";
  if (path.split("/").some((seg) => seg === ".." || seg.startsWith("."))) return new Response("Not found", { status: 404 });
  if (!/\.[a-z0-9]+$/i.test(path)) path += ".html"; // clean URLs, as on Cloudflare

  const cache = caches.default;
  const cacheKey = new Request(`https://preview-cache.invalid/${sha}/${path}`);
  let res = await cache.match(cacheKey);
  if (!res) {
    let upstream;
    try {
      upstream = await repo.readRaw(path, sha);
    } catch (e) {
      if (e.status === 404) return new Response("Not in this draft", { status: 404 });
      throw e;
    }
    const ext = path.split(".").pop().toLowerCase();
    let body = await upstream.arrayBuffer();
    if (ext === "html") {
      const html = new TextDecoder().decode(body).replace("</head>", `  ${BRIDGE}\n</head>`);
      body = new TextEncoder().encode(html);
    }
    res = new Response(body, {
      headers: { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable" },
    });
    await cache.put(cacheKey, res.clone());
  }
  // The browser may keep files (they never change for a given commit), but pages stay private
  const out = new Response(res.body, res);
  out.headers.set("Cache-Control", "private, max-age=31536000, immutable");
  out.headers.set("X-Robots-Tag", "noindex");
  return out;
}
