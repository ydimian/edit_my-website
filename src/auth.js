/**
 * auth.js — only the owner gets in.
 *
 * Cloudflare Access sits in front of edit.youhannad.com and signs every
 * request it lets through with a JWT (Cf-Access-Jwt-Assertion header, or the
 * CF_Authorization cookie). This Worker verifies that token itself, as a
 * second lock: signature (Access's public keys), issuer, audience (this
 * app's AUD tag), expiry, and that the email is OWNER_EMAIL. If Access is
 * ever misconfigured, the editor stays locked instead of open.
 *
 * Config (wrangler.jsonc vars): ACCESS_TEAM_DOMAIN, ACCESS_AUD, OWNER_EMAIL.
 * Local development only: DEV_AUTH_BYPASS=1 works on localhost and nowhere else.
 */

let jwksCache = { at: 0, keys: [], url: "" };

export class AuthError extends Error {
  constructor(message, status = 403) { super(message); this.status = status; }
}

export function isConfigured(env) {
  return Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD && env.OWNER_EMAIL);
}

export async function authenticate(request, env) {
  const url = new URL(request.url);
  if (env.DEV_AUTH_BYPASS === "1" && ["localhost", "127.0.0.1"].includes(url.hostname)) {
    return { email: env.OWNER_EMAIL || "dev@localhost", dev: true };
  }
  if (!isConfigured(env)) throw new AuthError("Cloudflare Access isn't configured for this editor yet.", 503);

  const token = request.headers.get("Cf-Access-Jwt-Assertion") || readCookie(request, "CF_Authorization");
  if (!token) throw new AuthError("Not signed in through Cloudflare Access.", 401);

  const team = teamOrigin(env.ACCESS_TEAM_DOMAIN);
  const { header, payload, signed, signature } = decode(token);
  const key = await findKey(team, header.kid);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, signed);
  if (!ok) throw new AuthError("Invalid sign-in token.");

  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== team) throw new AuthError("Sign-in token from the wrong Access team.");
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) throw new AuthError("Sign-in token is for a different application.");
  if (typeof payload.exp !== "number" || payload.exp < now) throw new AuthError("Sign-in expired. Reload the page.", 401);
  if (payload.nbf && payload.nbf > now + 60) throw new AuthError("Sign-in token not valid yet.");
  const email = String(payload.email || "").toLowerCase();
  if (email !== String(env.OWNER_EMAIL).toLowerCase()) throw new AuthError(`${email || "This account"} is not allowed to edit this site.`);
  return { email };
}

function teamOrigin(domain) {
  const host = String(domain).replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return `https://${host.includes(".") ? host : `${host}.cloudflareaccess.com`}`;
}

function readCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  return cookie.split(/;\s*/).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1) || null;
}

function b64urlBytes(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function decode(token) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthError("Malformed sign-in token.");
  const json = (p) => JSON.parse(new TextDecoder().decode(b64urlBytes(p)));
  const header = json(parts[0]);
  if (header.alg !== "RS256") throw new AuthError("Unexpected token algorithm.");
  return {
    header,
    payload: json(parts[1]),
    signed: new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    signature: b64urlBytes(parts[2]),
  };
}

async function findKey(team, kid) {
  const url = `${team}/cdn-cgi/access/certs`;
  const fresh = Date.now() - jwksCache.at < 10 * 60 * 1000 && jwksCache.url === url;
  if (!fresh || !jwksCache.keys.some((k) => k.kid === kid)) {
    const res = await fetch(url);
    if (!res.ok) throw new AuthError("Couldn't fetch Cloudflare Access keys.", 502);
    jwksCache = { at: Date.now(), keys: (await res.json()).keys || [], url };
  }
  const jwk = jwksCache.keys.find((k) => k.kid === kid);
  if (!jwk) throw new AuthError("Unknown signing key.");
  return crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
}
