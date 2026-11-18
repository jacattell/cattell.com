// Small helpers shared by both Workers. No packages.

/** Headers every reply gets: nothing on these addresses is meant to be framed, sniffed or cached. */
export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Strict-Transport-Security": "max-age=15552000",
};

/** Adds the security headers (and a strict CSP if none was set) to a reply. */
export function secure(response, csp = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'") {
  const r = new Response(response.body, response);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!r.headers.has(k)) r.headers.set(k, v);
  if (!r.headers.has("Content-Security-Policy")) r.headers.set("Content-Security-Policy", csp);
  return r;
}

export const json = (status, data, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });

const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** A plain "There is a problem" page, styled like the site, for form errors. */
export function problemPage(message, back, site) {
  const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>There is a problem – James Arthur Cattell</title><style>body{font-family:system-ui,sans-serif;font-size:1.1875rem;line-height:1.55;max-width:40rem;margin:2rem auto;padding:0 1rem;color:#0b0c0c;background:#fff}h1{font-size:2.25rem;line-height:1.2}.box{border:5px solid #b10e1e;padding:1rem 1.25rem}a{color:#00524f}a:focus{background:#fd0;color:#0b0c0c;outline:3px solid transparent;box-shadow:0 4px #0b0c0c;text-decoration:none}@media (prefers-color-scheme:dark){body{background:#111414;color:#f2f2f2}a{color:#8fe0db}.box{border-color:#ff8a8a}}</style></head><body><main><div class="box" role="alert" tabindex="-1"><h1>There is a problem</h1><p>${escapeHtml(message)}</p></div><p><a href="${escapeHtml(site + back)}">Go back to the form</a>. Your answers may still be there.</p></main></body></html>`;
  return new Response(html, {
    status: 400,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // Only the page's own style block is allowed. No scripts can run.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    },
  });
}

/**
 * Counts requests in a time window, per key, in this copy of the Worker only.
 * The firm limits are the Workers rate limiting binding and the spend cap; this is a back-up.
 */
export class RateLimiter {
  constructor(limit, windowMs, now = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.hits = new Map();
  }
  allow(key) {
    const now = this.now();
    const recent = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    const ok = recent.length < this.limit;
    if (ok) recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10000) for (const [k, t] of this.hits) if (!t.some((x) => now - x < this.windowMs)) this.hits.delete(k);
    return ok;
  }
}

/** Uses a Workers rate limiting binding if there is one; otherwise the in-memory back-up. */
export async function limited(binding, fallback, key) {
  if (binding && typeof binding.limit === "function") {
    try {
      const { success } = await binding.limit({ key });
      if (!success) return true;
    } catch {}
  }
  return !fallback.allow(key);
}

/** Compares two secrets without giving away, by timing, how much of a guess was right. */
export async function sameSecret(a, b) {
  const hash = async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s))));
  const [x, y] = await Promise.all([hash(a), hash(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
