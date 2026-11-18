// Reads and saves files in the GitHub repo as the GitHub App "cattellcom-editor",
// which is installed only on jacattell/cattell.com. No personal GitHub key is used.
// Settings: GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, GITHUB_APP_PRIVATE_KEY (the .pem file's text).

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = (s) => b64url(new TextEncoder().encode(s));

// GitHub gives a "BEGIN RSA PRIVATE KEY" (PKCS#1) file; browsers' crypto needs PKCS#8. This wraps one in the other.
function derLength(n) {
  if (n < 0x80) return [n];
  const bytes = [];
  while (n > 0) { bytes.unshift(n & 0xff); n >>= 8; }
  return [0x80 | bytes.length, ...bytes];
}
export function pkcs1ToPkcs8(pkcs1) {
  const algorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octet = [0x04, ...derLength(pkcs1.length), ...pkcs1];
  const body = [0x02, 0x01, 0x00, ...algorithm, ...octet];
  return new Uint8Array([0x30, ...derLength(body.length), ...body]);
}

export async function importPrivateKey(pem) {
  const pkcs1 = pem.includes("BEGIN RSA PRIVATE KEY");
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", pkcs1 ? pkcs1ToPkcs8(der) : der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

/** The short-lived app JWT GitHub asks for, signed with the app's private key. */
export async function appJwt(env, now = Date.now()) {
  const iat = Math.floor(now / 1000) - 60;
  const head = b64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64urlText(JSON.stringify({ iat, exp: iat + 540, iss: String(env.GITHUB_APP_ID) }));
  const key = await importPrivateKey(env.GITHUB_APP_PRIVATE_KEY);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}

let cached = { token: null, expires: 0 };

const headers = (auth) => ({
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "cattell.com admin",
  Authorization: `Bearer ${auth}`,
});

/** An installation key for the repo, limited to file contents, reused until 5 minutes before it runs out. */
async function installationToken(env, send, now) {
  if (cached.token && cached.expires - now > 300e3) return cached.token;
  const res = await send(`https://api.github.com/app/installations/${env.GITHUB_APP_INSTALLATION_ID}/access_tokens`, {
    method: "POST",
    headers: { ...headers(await appJwt(env, now)), "Content-Type": "application/json" },
    body: JSON.stringify({ repositories: [env.REPO.split("/")[1]], permissions: { contents: "write" } }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) throw new Error(`GitHub app key: ${res.status} ${data.message || ""}`);
  cached = { token: data.token, expires: Date.parse(data.expires_at) || now + 3000e3 };
  return cached.token;
}

export function resetTokenCache() { cached = { token: null, expires: 0 }; }

export const configured = (env) => Boolean(env.GITHUB_APP_ID && env.GITHUB_APP_INSTALLATION_ID && env.GITHUB_APP_PRIVATE_KEY && env.REPO);

/** Returns a function that calls the GitHub API as the app: gh(path, init) → { ok, status, data }. */
export function github(env, send = fetch, now = Date.now()) {
  return async (path, init = {}) => {
    const token = await installationToken(env, send, now);
    const res = await send(`https://api.github.com${path}`, {
      ...init,
      headers: { ...headers(token), ...(init.body ? { "Content-Type": "application/json" } : {}) },
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  };
}
