/**
 * worker.js — edit.youhannad.com
 *
 *   /api/*       editor actions (load, upload, save, release, discard)
 *   /preview/*   the saved draft, served privately
 *   everything   the editor app (public/)
 *
 * Every request is authenticated first (auth.js), including the editor's
 * own files.
 */
import { authenticate, AuthError } from "./auth.js";
import { Repo, GitHubError } from "./github.js";
import { readModel, applyChange, READ_FILES, BadRequest } from "./site-model.js";
import { servePreview } from "./preview.js";

const SECURITY_HEADERS = {
  "X-Frame-Options": "SAMEORIGIN",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let user;
    try {
      user = await authenticate(request, env);
    } catch (e) {
      return locked(e, url);
    }

    try {
      let res;
      if (url.pathname.startsWith("/api/")) res = await api(request, env, url, user);
      else if (url.pathname.startsWith("/preview/")) res = await servePreview(request, url, new Repo(env));
      else res = await env.ASSETS.fetch(request);
      return withHeaders(res);
    } catch (e) {
      const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
      if (status === 500) console.error(e);
      return json({ error: e.message || "Something went wrong" }, status);
    }
  },
};

/* ---------- API ---------- */

async function api(request, env, url, user) {
  // Same-origin JSON only: the custom header can't be sent cross-site without CORS, which we never allow
  if (request.method !== "GET" && (request.headers.get("X-Editor") !== "1" || !String(request.headers.get("Content-Type")).startsWith("application/json"))) {
    return json({ error: "Bad request" }, 400);
  }
  const route = `${request.method} ${url.pathname}`;

  if (route === "GET /api/session") {
    return json({
      email: user.email,
      dev: Boolean(user.dev),
      repo: `${env.GITHUB_OWNER}/${env.GITHUB_REPO}`,
      liveUrl: env.LIVE_URL || null,
      tokenConfigured: Boolean(env.GITHUB_TOKEN),
    });
  }

  const repo = new Repo(env);

  if (route === "POST /api/load") {
    const { liveSha, draftSha, changedFiles } = await repo.syncDraft();
    const files = await repo.readMany(READ_FILES, draftSha);
    return json({ liveSha, draftSha, changedFiles, model: readModel(files) });
  }

  // One photo file per request (keeps each request small: Workers' free plan allows ~10 ms CPU)
  if (route === "POST /api/upload") {
    const { base64 } = await request.json();
    if (typeof base64 !== "string" || !base64 || base64.length > 12_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
      throw new BadRequest("Upload must be a base64 file under 9 MB");
    }
    return json({ sha: await repo.createBlob(base64) });
  }

  if (route === "POST /api/save") {
    const { baseSha, change, message } = await request.json();
    if (!/^[0-9a-f]{40}$/.test(baseSha || "")) throw new BadRequest("baseSha is required");
    const files = await repo.readMany(READ_FILES, baseSha);
    const { changed, deletes, uploads, required } = applyChange(files, change || {});

    // Refuse to save a page pointing at a picture that doesn't exist
    if (required.length) {
      const existing = await repo.listFolder("assets/photos", baseSha);
      const uploaded = new Set(uploads.map((u) => u.path));
      const missing = required.filter((p) => !existing.has(p) && !uploaded.has(p));
      if (missing.length) throw new BadRequest(`Missing image files: ${missing.join(", ")}`);
    }

    const commitFiles = [
      ...Object.entries(changed).map(([path, text]) => ({ path, text })),
      ...uploads.map((u) => ({ path: u.path, sha: u.sha })),
      ...deletes.map((path) => ({ path, delete: true })),
    ];
    if (!commitFiles.length) return json({ draftSha: baseSha, unchanged: true });
    const summary = describe(change, commitFiles);
    const draftSha = await repo.commit(repo.draft, baseSha, commitFiles, String(message || summary).slice(0, 200));
    return json({ draftSha, files: commitFiles.map((f) => f.path) });
  }

  if (route === "POST /api/release") {
    const result = await repo.release("Release from the site editor");
    return json(result);
  }

  if (route === "POST /api/discard") {
    return json({ draftSha: await repo.discard() });
  }

  return json({ error: "Not found" }, 404);
}

/** A readable commit message for a save. */
function describe(change, files) {
  const parts = [];
  const nFields = Object.keys(change.fields || {}).length;
  if (nFields) parts.push(`${nFields} text edit${nFields === 1 ? "" : "s"}`);
  if (change.photos) parts.push("photos");
  if (Object.keys(change.images || {}).length) parts.push("page images");
  if (change.theme) parts.push("colours");
  return `Editor: ${parts.join(", ") || `${files.length} file(s)`}`;
}

/* ---------- responses ---------- */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

function withHeaders(res) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
}

function locked(error, url) {
  const status = error instanceof AuthError ? error.status : 403;
  if (url.pathname.startsWith("/api/")) return json({ error: error.message }, status);
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Editor locked</title><meta name="robots" content="noindex">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0e0e0c;color:#ece8dd;font:16px/1.6 system-ui,sans-serif}
main{max-width:520px;padding:32px}h1{font-weight:500;font-size:1.6rem;margin:0 0 8px}p{color:#b4afa2}code{color:#ef6a3f}</style>
<main><h1>This editor is locked</h1><p>${escapeHtml(error.message)}</p>
<p>Only the site owner can open it, through Cloudflare Access.</p></main>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...SECURITY_HEADERS } });
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export { GitHubError };
