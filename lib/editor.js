// The week notes editor (/edit/): GitHub sign-in, and reading and saving notes
// in the GitHub repo. Only accounts listed in EDITORS (default: jacattell) can
// sign in, and only week note files in this repo can be changed.
//
// Settings (Cloudflare Pages, Production):
//   GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET  from the GitHub OAuth App
//   SESSION_SECRET                          a long random string, used to encrypt sign-ins
//   EDITORS                                 optional, comma-separated GitHub usernames
import MarkdownIt from "markdown-it";

const REPO = "jacattell/cattell.com";
const BRANCH = "main";
const NOTES_DIR = "src/week-notes";
const SESSION_HOURS = 8;
const NOTE_PATH = /^(\d{4})\/(\d{2})$/;
// The same settings as the site (eleventy.config.js), so the preview matches.
const markdown = new MarkdownIt({ html: true });

// ---------- small helpers ----------
const json = (status, data, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
const redirect = (to, cookies = []) => {
  const headers = new Headers({ Location: to, "Cache-Control": "no-store" });
  cookies.forEach((c) => headers.append("Set-Cookie", c));
  return new Response(null, { status: 302, headers });
};
const cookie = (name, value, { maxAge, sameSite = "Strict", path = "/" } = {}) =>
  `${name}=${value}; Path=${path}; HttpOnly; Secure; SameSite=${sameSite}${maxAge !== undefined ? `; Max-Age=${maxAge}` : ""}`;
const readCookie = (request, name) =>
  (request.headers.get("Cookie") || "").split(/;\s*/).map((c) => c.split("=")).find(([k]) => k === name)?.slice(1).join("=") || null;

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
export const utf8ToBase64 = (text) => {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
export const base64ToUtf8 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));

// ---------- encrypted session cookie ----------
// The encryption key is derived from SESSION_SECRET with HKDF (SHA-256), the standard way
// to turn a secret into a key. The salt and label tie the key to this one use.
const KEY_SALT = new TextEncoder().encode("cattell.com editor session v1");
const KEY_INFO = new TextEncoder().encode("edit_session cookie, AES-256-GCM");
async function key(secret) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: KEY_SALT, info: KEY_INFO },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}
export async function sealSession(data, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new TextEncoder().encode(JSON.stringify({ ...data, exp: Date.now() + SESSION_HOURS * 3600e3 }));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(secret), body));
  return b64url(new Uint8Array([...iv, ...sealed]));
}
export async function openSession(value, secret) {
  try {
    const bytes = fromB64url(value);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, await key(secret), bytes.slice(12));
    const data = JSON.parse(new TextDecoder().decode(plain));
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

// ---------- GitHub ----------
function github(token, send) {
  return async (path, init = {}) => {
    const res = await send(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "cattell.com editor",
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  };
}

const editors = (env) => (env.EDITORS || "jacattell").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const configured = (env) => env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.SESSION_SECRET && env.SESSION_SECRET.length >= 32;

// ---------- sign in and out ----------
export async function handleLogin(request, env) {
  if (!configured(env)) return redirect("/edit/?problem=setup");
  const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
  const callback = new URL("/api/auth/callback", request.url).toString();
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri", callback);
  url.searchParams.set("scope", "public_repo");
  url.searchParams.set("state", state);
  url.searchParams.set("allow_signup", "false");
  // Lax, so the cookie comes back when GitHub sends the browser back here.
  return redirect(url.toString(), [cookie("edit_state", state, { maxAge: 600, sameSite: "Lax", path: "/api/auth/" })]);
}

export async function handleCallback(request, env, send = fetch) {
  if (!configured(env)) return redirect("/edit/?problem=setup");
  const url = new URL(request.url);
  const state = readCookie(request, "edit_state");
  const clearState = cookie("edit_state", "", { maxAge: 0, sameSite: "Lax", path: "/api/auth/" });
  if (!state || state !== url.searchParams.get("state") || !url.searchParams.get("code")) return redirect("/edit/?problem=signin", [clearState]);

  const tokenRes = await send("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "cattell.com editor" },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code: url.searchParams.get("code"), redirect_uri: new URL("/api/auth/callback", request.url).toString() }),
  });
  const { access_token: token } = await tokenRes.json().catch(() => ({}));
  if (!token) return redirect("/edit/?problem=signin", [clearState]);

  const me = await github(token, send)("/user");
  const login = me.data?.login;
  if (!login || !editors(env).includes(login.toLowerCase())) return redirect("/edit/?problem=notallowed", [clearState]);

  const session = await sealSession({ token, login }, env.SESSION_SECRET);
  return redirect("/edit/", [clearState, cookie("edit_session", session, { maxAge: SESSION_HOURS * 3600 })]);
}

/**
 * Signs out: only from this site's own sign-out button (other sites can't sign
 * James out), and cancels the GitHub key too, so a copy of it is no use.
 */
export async function handleLogout(request, env = {}, send = fetch) {
  // Browsers send Origin with forms; a few privacy tools remove it, so Sec-Fetch-Site is accepted too.
  const origin = request.headers.get("Origin");
  const sameSite = origin ? origin === new URL(request.url).origin : request.headers.get("Sec-Fetch-Site") === "same-origin";
  if (!sameSite) return redirect("/edit/");
  const value = readCookie(request, "edit_session");
  const session = value && configured(env) ? await openSession(value, env.SESSION_SECRET) : null;
  if (session) {
    await send(`https://api.github.com/applications/${env.GITHUB_CLIENT_ID}/token`, {
      method: "DELETE",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "cattell.com editor",
        Authorization: `Basic ${btoa(`${env.GITHUB_CLIENT_ID}:${env.GITHUB_CLIENT_SECRET}`)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ access_token: session.token }),
    }).catch((err) => console.error(`GitHub key not cancelled: ${err.message}`));
  }
  return redirect("/edit/", [cookie("edit_session", "", { maxAge: 0 })]);
}

// ---------- notes ----------
/**
 * Other front matter lines are sent back as they were read. Each must stay one
 * line and must not end the front matter block, or it could add settings.
 */
export const safeFrontMatterLine = (line) => typeof line === "string" && !/[\r\n]/.test(line) && line.trim() !== "---" && line.length <= 500;

/** Splits a note file into its summary, any other front matter lines, and the Markdown body. */
export function parseNote(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { summary: "", other: [], body: text };
  let summary = "";
  const other = [];
  for (const line of m[1].split(/\r?\n/)) {
    const s = /^summary:\s*(.*)$/.exec(line);
    if (s) {
      try { summary = s[1].startsWith('"') ? JSON.parse(s[1]) : s[1]; } catch { summary = s[1]; }
    } else if (line.trim()) other.push(line);
  }
  return { summary, other, body: m[2].replace(/^\n/, "") };
}

/** Builds a note file in the same format as the existing ones. */
export function buildNote({ summary, other = [], body }) {
  const front = [...(summary ? [`summary: ${JSON.stringify(summary)}`] : []), ...other];
  const text = body.replace(/\r\n/g, "\n").replace(/\s+$/, "") + "\n";
  return front.length ? `---\n${front.join("\n")}\n---\n\n${text}` : text;
}

async function signedIn(request, env) {
  if (!configured(env)) return null;
  const value = readCookie(request, "edit_session");
  const session = value && (await openSession(value, env.SESSION_SECRET));
  return session && editors(env).includes(session.login.toLowerCase()) ? session : null;
}

/** Handles /api/edit/*: me, notes, note, preview. */
export async function handleEdit(request, env, send = fetch) {
  const url = new URL(request.url);
  const action = url.pathname.replace(/^\/api\/edit\/?/, "").replace(/\/$/, "");

  if (action === "me" && request.method === "GET") {
    if (!configured(env)) return json(503, { error: "setup" });
    const session = await signedIn(request, env);
    return session ? json(200, { login: session.login }) : json(401, { error: "signin" });
  }

  const session = await signedIn(request, env);
  if (!session) return json(401, { error: "Please sign in again." });
  // Changes must come from the editor page itself (a header other sites can't send).
  if (request.method !== "GET" && request.headers.get("X-Editor") !== "1") return json(403, { error: "Not allowed." });
  const gh = github(session.token, send);

  if (action === "notes" && request.method === "GET") {
    const tree = await gh(`/repos/${REPO}/git/trees/${BRANCH}?recursive=1`);
    if (!tree.ok) return json(502, { error: "Could not read the notes from GitHub." });
    const notes = tree.data.tree
      .map((t) => new RegExp(`^${NOTES_DIR}/(\\d{4})/(\\d{2})\\.md$`).exec(t.path))
      .filter(Boolean)
      .map((m) => ({ path: `${m[1]}/${m[2]}`, year: Number(m[1]), week: Number(m[2]) }))
      .sort((a, b) => b.year - a.year || b.week - a.week);
    return json(200, { notes });
  }

  if (action === "note") {
    const path = request.method === "GET" ? url.searchParams.get("path") : null;
    if (request.method === "GET") {
      if (!NOTE_PATH.test(path || "")) return json(400, { error: "That isn't a week note." });
      const file = await gh(`/repos/${REPO}/contents/${NOTES_DIR}/${path}.md?ref=${BRANCH}`);
      if (file.status === 404) return json(404, { error: "That week note doesn't exist yet." });
      if (!file.ok) return json(502, { error: "Could not read the note from GitHub." });
      return json(200, { path, sha: file.data.sha, ...parseNote(base64ToUtf8(file.data.content)) });
    }
    if (request.method === "PUT") {
      const input = await request.json().catch(() => null);
      if (!input || !NOTE_PATH.test(input.path || "")) return json(400, { error: "That isn't a week note." });
      const [, year, week] = NOTE_PATH.exec(input.path);
      if (Number(week) < 1 || Number(week) > 53) return json(400, { error: "Week numbers go from 1 to 53." });
      if (typeof input.body !== "string" || !input.body.trim()) return json(400, { error: "The note is empty." });
      const other = input.other ?? [];
      if (!Array.isArray(other) || !other.every(safeFrontMatterLine)) return json(400, { error: "The note's settings were not in the right format." });
      const summary = String(input.summary || "").replace(/\s+/g, " ").trim();
      const content = buildNote({ summary, other, body: input.body });
      const message = String(input.message || "").trim() || `${input.sha ? "Update" : "Add"} week note: week ${Number(week)}, ${year}`;
      const saved = await gh(`/repos/${REPO}/contents/${NOTES_DIR}/${input.path}.md`, {
        method: "PUT",
        body: JSON.stringify({ message, content: utf8ToBase64(content), branch: BRANCH, ...(input.sha ? { sha: input.sha } : {}) }),
      });
      if (saved.status === 409 || saved.status === 422) {
        return json(409, { error: input.sha ? "This note was changed somewhere else since you opened it. Copy your text, reload the note, and try again." : "A note for that week already exists. Open it from the list instead." });
      }
      if (!saved.ok) return json(502, { error: "GitHub didn't accept the change. Please try again." });
      return json(200, { sha: saved.data.content?.sha, commit: saved.data.commit?.html_url, url: `/week-notes/${year}/${week}/` });
    }
  }

  // ---------- chat logs (see lib/chat.js) ----------
  if (action === "chats" && request.method === "GET") {
    if (!env.CHAT_LOGS) return json(503, { error: "Chat logs aren't set up yet. See \"Chat logs\" in the README." });
    const page = await env.CHAT_LOGS.list({ prefix: "conv:", limit: 50, cursor: url.searchParams.get("cursor") || undefined });
    // Each conversation's summary is normally stored with its key. If it isn't
    // there, read the conversation itself; the start time is also in the ID.
    const chats = await Promise.all(page.keys.map(async (k) => {
      const id = k.name.slice(5);
      let summary = k.metadata && k.metadata.started && k.metadata.turns ? k.metadata : null;
      if (!summary) {
        const record = await env.CHAT_LOGS.get(k.name, "json").catch(() => null);
        summary = record?.turns?.length
          ? { started: record.started, updated: record.updated, turns: record.turns.length, first: String(record.turns[0].q || "").slice(0, 150) }
          : {};
      }
      const fromId = /^\d{13}-/.test(id) ? new Date(1e13 - Number(id.slice(0, 13))).toISOString() : null;
      return {
        id,
        started: summary.started || fromId,
        updated: summary.updated || null,
        turns: Number(summary.turns) || 0,
        first: summary.first || "",
        expires: k.expiration ? new Date(k.expiration * 1000).toISOString() : null,
      };
    }));
    return json(200, { chats, cursor: page.list_complete ? null : page.cursor });
  }
  if (action === "chat" && request.method === "GET") {
    if (!env.CHAT_LOGS) return json(503, { error: "Chat logs aren't set up yet." });
    const id = url.searchParams.get("id") || "";
    if (!/^\d{13}-[a-z0-9]{8}$/.test(id)) return json(400, { error: "That isn't a conversation." });
    const record = await env.CHAT_LOGS.get(`conv:${id}`, "json");
    return record ? json(200, record) : json(404, { error: "That conversation has been deleted." });
  }

  if (action === "preview" && request.method === "POST") {
    const input = await request.json().catch(() => ({}));
    return json(200, { html: markdown.render(String(input.body || "")) });
  }

  return json(404, { error: "Not found." });
}
