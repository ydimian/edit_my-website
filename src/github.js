/**
 * github.js — the portfolio repo as draft / live branches.
 *
 *   live  (main)   what youhannad.com serves; Cloudflare deploys every push
 *   draft (draft)  where the editor saves; previewed privately in the editor
 *
 * Upload  = one new photo file stored as a blob (not on any branch yet)
 * Save    = one commit on draft (Git Data API: tree -> commit -> ref)
 * Release = move main up to draft (fast-forward), or merge if main moved on
 * Discard = reset draft back to main
 *
 * The token never leaves the Worker; it needs Contents: read & write on the
 * portfolio repo only.
 */

export class GitHubError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export class Repo {
  constructor(env) {
    if (!env.GITHUB_TOKEN) throw new GitHubError("GITHUB_TOKEN is not set: add it as a secret on this Worker", 503);
    this.api = (env.GITHUB_API || "https://api.github.com").replace(/\/$/, "");
    this.base = `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}`;
    this.token = env.GITHUB_TOKEN;
    this.live = env.LIVE_BRANCH || "main";
    this.draft = env.DRAFT_BRANCH || "draft";
  }

  async request(path, { method = "GET", body, accept = "application/vnd.github+json", raw = false } = {}) {
    const res = await fetch(`${this.api}${this.base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: accept,
        "User-Agent": "edit-youhannad",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new GitHubError(`GitHub ${method} ${path}: ${res.status} ${detail.message || res.statusText}`, res.status);
    }
    return raw ? res : res.json();
  }

  /* ---------- refs ---------- */

  async refSha(branch) {
    try {
      return (await this.request(`/git/ref/heads/${branch}`)).object.sha;
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  setRef(branch, sha, force = false) {
    return this.request(`/git/refs/heads/${branch}`, { method: "PATCH", body: { sha, force } });
  }

  createRef(branch, sha) {
    return this.request(`/git/refs`, { method: "POST", body: { ref: `refs/heads/${branch}`, sha } });
  }

  compare(base, head) {
    return this.request(`/compare/${base}...${head}`);
  }

  /** Merge `head` into `base`. Returns the merge commit sha, or null if there was nothing to merge. */
  async merge(base, head, message) {
    try {
      const res = await this.request(`/merges`, { method: "POST", body: { base, head, commit_message: message } });
      return res ? res.sha : null;
    } catch (e) {
      if (e.status === 409) throw new GitHubError("The live site and your draft changed the same lines. Discard the draft or fix the conflict on GitHub.", 409);
      throw e;
    }
  }

  /* ---------- branch status ---------- */

  /**
   * Make sure draft exists and contains everything on live (e.g. changes
   * pushed straight to main). Returns { liveSha, draftSha, changedFiles }.
   */
  async syncDraft() {
    const liveSha = await this.refSha(this.live);
    if (!liveSha) throw new GitHubError(`Branch ${this.live} not found`, 404);
    let draftSha = await this.refSha(this.draft);
    if (!draftSha) {
      await this.createRef(this.draft, liveSha);
      draftSha = liveSha;
    }
    let cmp = await this.compare(this.live, this.draft);
    if (cmp.status === "behind") {
      await this.setRef(this.draft, liveSha);
      draftSha = liveSha;
      cmp = { status: "identical", files: [] };
    } else if (cmp.status === "diverged") {
      draftSha = (await this.merge(this.draft, this.live, "Bring draft up to date with the live site")) || draftSha;
      cmp = await this.compare(this.live, this.draft);
    }
    return { liveSha, draftSha, changedFiles: (cmp.files || []).map((f) => ({ path: f.filename, status: f.status })) };
  }

  /* ---------- files ---------- */

  async readText(path, ref) {
    const res = await this.request(`/contents/${encodePath(path)}?ref=${ref}`, { accept: "application/vnd.github.raw", raw: true });
    return res.text();
  }

  async readRaw(path, ref) {
    return this.request(`/contents/${encodePath(path)}?ref=${ref}`, { accept: "application/vnd.github.raw", raw: true });
  }

  async readMany(paths, ref) {
    const entries = await Promise.all(paths.map(async (p) => [p, await this.readText(p, ref)]));
    return Object.fromEntries(entries);
  }

  /** All file paths under a folder at a ref (for existence checks). */
  async listFolder(folder, ref) {
    try {
      const items = await this.request(`/contents/${encodePath(folder)}?ref=${ref}`);
      return new Set(items.map((i) => i.path));
    } catch (e) {
      if (e.status === 404) return new Set();
      throw e;
    }
  }

  /* ---------- commits ---------- */

  /** Store one file's contents; returns its blob sha for a later commit. */
  async createBlob(base64) {
    return (await this.request(`/git/blobs`, { method: "POST", body: { content: base64, encoding: "base64" } })).sha;
  }

  /**
   * One commit on `branch` on top of `expectedSha`.
   * files: [{ path, text } | { path, sha } (uploaded blob) | { path, delete: true }]
   */
  async commit(branch, expectedSha, files, message) {
    const parent = await this.request(`/git/commits/${expectedSha}`);
    const tree = [];
    for (const f of files) {
      if (f.delete) {
        tree.push({ path: f.path, mode: "100644", type: "blob", sha: null });
      } else if (f.sha) {
        tree.push({ path: f.path, mode: "100644", type: "blob", sha: f.sha });
      } else {
        tree.push({ path: f.path, mode: "100644", type: "blob", content: f.text });
      }
    }
    const newTree = await this.request(`/git/trees`, { method: "POST", body: { base_tree: parent.tree.sha, tree } });
    const commit = await this.request(`/git/commits`, { method: "POST", body: { message, tree: newTree.sha, parents: [expectedSha] } });
    try {
      await this.setRef(branch, commit.sha, false); // fails if the branch moved since expectedSha
    } catch (e) {
      if (e.status === 422) throw new GitHubError("The draft changed since you loaded the editor (another tab?). Reload, then save again.", 409);
      throw e;
    }
    return commit.sha;
  }

  /* ---------- release / discard ---------- */

  async release(message) {
    const { liveSha, draftSha } = await this.syncDraft();
    if (liveSha === draftSha) return { released: false, sha: liveSha };
    const cmp = await this.compare(this.live, this.draft);
    if (cmp.status === "ahead") {
      await this.setRef(this.live, draftSha, false); // fast-forward: live becomes exactly the draft
      return { released: true, sha: draftSha };
    }
    const sha = await this.merge(this.live, this.draft, message);
    return { released: true, sha };
  }

  async discard() {
    const liveSha = await this.refSha(this.live);
    await this.setRef(this.draft, liveSha, true);
    return liveSha;
  }
}

const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");
