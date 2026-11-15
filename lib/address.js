// Which addresses the API answers on.
//
// Cloudflare gives every Pages project a second address ending in pages.dev
// (cattell-com.pages.dev, plus one for each preview). The rate limiting rule
// and other security rules belong to cattell.com, so they don't cover those
// addresses. The API (chat, forms, editor, sessions archive) is switched off
// there, so nobody can use it to get round the rules. The pages themselves
// still load, so a preview can be looked at.

const SITE = "https://www.cattell.com";

/** A "not here" reply when the request came to a pages.dev address, or null when it's fine. */
export function refuseOtherAddress(request) {
  const host = new URL(request.url).hostname.toLowerCase();
  if (host !== "pages.dev" && !host.endsWith(".pages.dev")) return null;
  return new Response(JSON.stringify({ error: `This only works on ${SITE}` }), {
    status: 404,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}
