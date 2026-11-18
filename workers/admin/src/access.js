// Checks the sign-in that Cloudflare Access adds to every request it lets through.
// Access already blocks everyone else before they reach this Worker; checking again here
// means a mistake in the Access settings still can't expose anything.
// https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/

const b64urlBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

let certCache = { team: null, keys: null, at: 0 };

/** Access's public keys for the team, kept for an hour. `fetcher` is replaceable in tests. */
async function publicKeys(team, fetcher, now) {
  if (certCache.team === team && certCache.keys && now - certCache.at < 3600e3) return certCache.keys;
  const res = await fetcher(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs: ${res.status}`);
  const { keys } = await res.json();
  certCache = { team, keys, at: now };
  return keys;
}

export function resetKeyCache() { certCache = { team: null, keys: null, at: 0 }; }

/**
 * Returns who is signed in ({ email }), or null if it isn't one of ADMIN_EMAILS.
 * env.ACCESS_TEAM: e.g. cattell.cloudflareaccess.com   env.ACCESS_AUD: the application's AUD tag.
 */
export async function verifyAccess(request, env, fetcher = fetch, now = Date.now()) {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || !env.ACCESS_TEAM || !env.ACCESS_AUD) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header, claims;
  try { header = b64urlJson(parts[0]); claims = b64urlJson(parts[1]); } catch { return null; }
  if (header.alg !== "RS256" || !header.kid) return null;

  let keys;
  try { keys = await publicKeys(env.ACCESS_TEAM, fetcher, now); } catch (e) { console.error(e.message); return null; }
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) return null;

  const seconds = Math.floor(now / 1000);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(env.ACCESS_AUD)) return null;
  if (claims.iss !== `https://${env.ACCESS_TEAM}`) return null;
  if (typeof claims.exp !== "number" || claims.exp < seconds - 30) return null;
  if (typeof claims.nbf === "number" && claims.nbf > seconds + 30) return null;

  if (!claims.email) return null;
  const allowed = String(env.ADMIN_EMAILS || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  return allowed.includes(String(claims.email).toLowerCase()) ? { email: claims.email } : null;
}
