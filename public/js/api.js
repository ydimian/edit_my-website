/**
 * api.js — calls to the editor's Worker (/api/*).
 * Every write carries the X-Editor header; the Worker rejects writes without it.
 */
async function call(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: { "X-Editor": "1", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // Typically the Cloudflare Access session expired and the request was redirected to its login page
    throw Object.assign(new Error("Lost connection to the editor. Your sign-in may have expired: reload the page."), { status: 0 });
  }
  let data = {};
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw Object.assign(new Error(data.error || `${res.status} ${res.statusText}`), { status: res.status });
  return data;
}

export const api = {
  session: () => call("GET", "/api/session"),
  load: () => call("POST", "/api/load", {}),
  upload: (base64) => call("POST", "/api/upload", { base64 }),
  save: (body) => call("POST", "/api/save", body),
  release: () => call("POST", "/api/release", {}),
  discard: () => call("POST", "/api/discard", {}),
};
