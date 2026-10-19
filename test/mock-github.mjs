// A tiny in-memory stand-in for the GitHub API endpoints the editor uses,
// so the whole save / preview / release flow can be tested locally without a
// real repo or token. Seeded from the portfolio folder this project lives in.
//
//   node test/mock-github.mjs [port]      (default 8788)
//   GET /__mock/refs                      current branch -> commit
import { createServer } from "node:http";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { SITE as SITE_URL } from "./site.mjs";

const PORT = Number(process.argv[2] || 8788);
const SITE = fileURLToPath(SITE_URL);
const SKIP = new Set([".git", ".claude", ".wrangler", "node_modules", "edit_myportfolio", "Images", "Context_folder", "Logo", "Logo_v1.jpeg"]);

const blobs = new Map();   // sha -> Buffer
const trees = new Map();   // sha -> Map(path -> blobSha)
const commits = new Map(); // sha -> { tree, parents, message }
const refs = new Map();    // branch -> commit sha
const hash = (...parts) => createHash("sha1").update(parts.join("\0")).digest("hex");

function putBlob(buf) { const sha = hash("blob", buf.toString("base64")); blobs.set(sha, buf); return sha; }
function putTree(map) { const sha = hash("tree", [...map].sort().map(([p, s]) => `${p}:${s}`).join("|")); trees.set(sha, new Map(map)); return sha; }
function putCommit(tree, parents, message) { const sha = hash("commit", tree, parents.join(","), message, String(commits.size)); commits.set(sha, { tree, parents, message }); return sha; }

// Seed main from the working tree
function seed() {
  const files = new Map();
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) visit(full);
      else files.set(relative(SITE, full).split(sep).join("/"), putBlob(readFileSync(full)));
    }
  };
  visit(SITE);
  refs.set("main", putCommit(putTree(files), [], "Initial"));
}
seed();

function ancestors(sha) {
  const out = new Set();
  const stack = [sha];
  while (stack.length) { const s = stack.pop(); if (out.has(s)) continue; out.add(s); stack.push(...(commits.get(s)?.parents || [])); }
  return out;
}
const resolve = (ref) => refs.get(ref) || (commits.has(ref) ? ref : null);
function diffTrees(a, b) {
  const A = trees.get(a), B = trees.get(b), files = [];
  for (const [p, s] of B) if (!A.has(p)) files.push({ filename: p, status: "added" }); else if (A.get(p) !== s) files.push({ filename: p, status: "modified" });
  for (const p of A.keys()) if (!B.has(p)) files.push({ filename: p, status: "removed" });
  return files;
}

function compare(base, head) {
  const b = resolve(base), h = resolve(head);
  const ancH = ancestors(h), ancB = ancestors(b);
  const status = b === h ? "identical" : ancH.has(b) ? "ahead" : ancB.has(h) ? "behind" : "diverged";
  return { status, ahead_by: [...ancH].filter((s) => !ancB.has(s)).length, behind_by: [...ancB].filter((s) => !ancH.has(s)).length, files: diffTrees(commits.get(b).tree, commits.get(h).tree) };
}

function merge(base, head, message) {
  const b = refs.get(base), h = resolve(head);
  if (ancestors(b).has(h)) return null; // nothing to merge
  const ancB = ancestors(b);
  const mb = [...ancestors(h)].find((s) => ancB.has(s));
  const T0 = trees.get(commits.get(mb).tree), TB = trees.get(commits.get(b).tree), TH = trees.get(commits.get(h).tree);
  const out = new Map(TB);
  for (const p of new Set([...T0.keys(), ...TH.keys()])) {
    const o = T0.get(p), x = TB.get(p), y = TH.get(p);
    if (y === o) continue;            // head didn't touch it
    if (x !== o && x !== y) throw Object.assign(new Error("Merge conflict"), { status: 409 });
    if (y === undefined) out.delete(p); else out.set(p, y);
  }
  const sha = putCommit(putTree(out), [b, h], message);
  refs.set(base, sha);
  return sha;
}

const send = (res, status, body, type = "application/json") => {
  res.writeHead(status, { "Content-Type": type });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString() || "{}") : {};
  const p = url.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, "");
  try {
    if (url.pathname === "/__mock/refs") return send(res, 200, Object.fromEntries(refs));
    let m;
    if (req.method === "GET" && (m = p.match(/^\/git\/ref\/heads\/(.+)$/))) {
      const sha = refs.get(m[1]);
      return sha ? send(res, 200, { object: { sha } }) : send(res, 404, { message: "Not Found" });
    }
    if (req.method === "POST" && p === "/git/refs") { refs.set(body.ref.replace("refs/heads/", ""), body.sha); return send(res, 201, { object: { sha: body.sha } }); }
    if (req.method === "PATCH" && (m = p.match(/^\/git\/refs\/heads\/(.+)$/))) {
      const cur = refs.get(m[1]);
      if (!body.force && cur && !ancestors(body.sha).has(cur)) return send(res, 422, { message: "Update is not a fast forward" });
      refs.set(m[1], body.sha);
      return send(res, 200, { object: { sha: body.sha } });
    }
    if (req.method === "GET" && (m = p.match(/^\/compare\/(.+)\.\.\.(.+)$/))) return send(res, 200, compare(m[1], m[2]));
    if (req.method === "POST" && p === "/merges") {
      const sha = merge(body.base, body.head, body.commit_message);
      return sha ? send(res, 201, { sha }) : (res.writeHead(204), res.end());
    }
    if (req.method === "GET" && (m = p.match(/^\/git\/commits\/([0-9a-f]{40})$/))) {
      const c = commits.get(m[1]);
      return c ? send(res, 200, { sha: m[1], tree: { sha: c.tree } }) : send(res, 404, { message: "Not Found" });
    }
    if (req.method === "POST" && p === "/git/blobs") return send(res, 201, { sha: putBlob(Buffer.from(body.content, body.encoding === "base64" ? "base64" : "utf8")) });
    if (req.method === "POST" && p === "/git/trees") {
      const map = new Map(trees.get(body.base_tree));
      for (const e of body.tree) {
        if (e.sha === null) map.delete(e.path);
        else map.set(e.path, e.sha || putBlob(Buffer.from(e.content, "utf8")));
      }
      return send(res, 201, { sha: putTree(map) });
    }
    if (req.method === "POST" && p === "/git/commits") return send(res, 201, { sha: putCommit(body.tree, body.parents, body.message) });
    if (req.method === "GET" && (m = p.match(/^\/contents\/(.*)$/))) {
      const path = decodeURIComponent(m[1]);
      const sha = resolve(url.searchParams.get("ref") || "main");
      const tree = trees.get(commits.get(sha).tree);
      if (tree.has(path)) return send(res, 200, blobs.get(tree.get(path)), "application/octet-stream");
      const dir = [...tree.keys()].filter((k) => k.startsWith(path + "/") && !k.slice(path.length + 1).includes("/"));
      return dir.length ? send(res, 200, dir.map((k) => ({ path: k, type: "file" }))) : send(res, 404, { message: "Not Found" });
    }
    send(res, 404, { message: `Mock: no route for ${req.method} ${p}` });
  } catch (e) {
    send(res, e.status || 500, { message: e.message });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`mock GitHub on http://127.0.0.1:${PORT} (main = ${refs.get("main").slice(0, 7)})`));
