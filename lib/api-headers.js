// Security headers for everything under /api/.
//
// Cloudflare applies src/_headers to the site's files, but not to replies made
// by the functions (chat, forms, editor, sessions archive). This adds the same
// protections to those replies. A header a function sets itself is kept.

const BASE = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

// API replies are data or a plain message page: nothing in them may run, and
// they may only use the site's own stylesheet and images.
const POLICY = "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

/** Returns the reply with the security headers added. */
export function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(BASE)) if (!headers.has(name)) headers.set(name, value);
  if (!headers.has("Content-Security-Policy")) headers.set("Content-Security-Policy", POLICY);
  // A WebSocket upgrade reply cannot be copied (the API has none, but just in case).
  if (response.status === 101 || response.webSocket) return response;
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
