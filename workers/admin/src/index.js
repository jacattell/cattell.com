// cattell-admin: https://admin.cattell.com — James's private tools.
//   /            edit week notes (saves to GitHub as the cattellcom-editor app)
//   /chats/      read the "Ask my AI" chat logs
//   /sessions/   search the Claude sessions archive
//   /api/upload  where the session upload scripts send sessions (needs ARCHIVE_KEY)
//
// Two locks: Cloudflare Access lets only James through, and this Worker checks Access's
// signed sign-in on every request, pages included. The one exception is /api/upload, which
// Access lets through ("Bypass") so upload scripts can reach it: it needs the long ARCHIVE_KEY,
// and it can only add sessions, never read them.
import { verifyAccess } from "./access.js";
import { configured } from "./github.js";
import { handleNotes } from "./notes.js";
import { handleChats } from "./chats.js";
import { handleSessions, handleUpload } from "./sessions.js";
import { json, secure } from "../../shared/http.js";

// The admin pages: only their own scripts and styles, nothing from anywhere else.
export const PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https://www.cattell.com; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'";

const noStore = (r) => { const x = new Response(r.body, r); x.headers.set("Cache-Control", "no-store"); x.headers.set("X-Robots-Tag", "noindex, nofollow"); return x; };

/** Changes must come from these pages: same origin, and a header other sites can't send without permission. */
export function sameSite(request) {
  const origin = request.headers.get("Origin");
  const ok = origin ? origin === new URL(request.url).origin : request.headers.get("Sec-Fetch-Site") === "same-origin";
  return ok && request.headers.get("X-Admin") === "1";
}

export async function handle(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  if (url.hostname !== (env.ADMIN_HOST || "admin.cattell.com")) return new Response("Not found", { status: 404 });

  if (url.pathname === "/api/upload") return handleUpload(request, env);

  const who = await verifyAccess(request, env, fetcher);
  if (!who) return new Response("Not signed in. Go to https://admin.cattell.com to sign in.", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });

  if (url.pathname.startsWith("/api/")) {
    const action = url.pathname.slice(5).replace(/\/$/, "");
    if (request.method !== "GET" && !sameSite(request)) return json(403, { error: "Not allowed." });
    if (action === "me") return json(200, { email: who.email, github: configured(env) });
    if (["notes", "note", "preview"].includes(action)) {
      if (!configured(env)) return json(503, { error: "Saving to GitHub isn't set up yet." });
      return handleNotes(action, request, env, fetcher);
    }
    if (action === "chats" || action === "chat") return handleChats(action, request, env);
    if (["sessions", "session", "message"].includes(action)) return handleSessions(action, request, env);
    return json(404, { error: "Not found." });
  }

  if (!env.ASSETS) return new Response("Not found", { status: 404 });
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env) {
    let response;
    try {
      response = await handle(request, env);
    } catch (err) {
      console.error(`Admin: ${err.stack || err.message}`);
      response = json(500, { error: "Something went wrong." });
    }
    return secure(noStore(response), PAGE_CSP);
  },
};
