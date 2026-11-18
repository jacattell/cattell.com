// The Claude sessions archive (admin.cattell.com/sessions/): James's prompts and Claude's answers, with
// Claude's thinking, tool calls and tool results, from Claude Code and from Claude chats,
// saved in a Cloudflare D1 database and searchable.
//
// Private: only James can read it, behind Cloudflare Access (see workers/admin/src/index.js). Each session has a
// `public` setting, off for all of them, so single sessions could be published later.
//
// Settings (the cattell-admin Worker):
//   SESSIONS     the D1 database binding (wrangler.toml)
//   ARCHIVE_KEY  a long random string; the upload scripts send it to prove who they are
import { readText } from "../../shared/body.js";

const SOURCES = ["code", "chat"];
// What a message is. Only the first two are the conversation itself; see lib/session-formats.js.
const KINDS = ["prompt", "answer", "thinking", "tool", "result", "file"];
const TALK = "('prompt', 'answer')";
const PREVIEW = 2000; // characters of thinking, tool calls and results sent with a session; the rest on request
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
const MAX_BODY_BYTES = 900_000; // one upload; longer sessions are sent in parts
const MAX_TEXT = 200_000; // characters in one message
const PAGE = 50; // sessions or search results per page
const MESSAGES_PAGE = 500;

const json = (status, data) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

// ---------- the database ----------
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, source TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', project TEXT NOT NULL DEFAULT '',
    started TEXT, updated TEXT, messages INTEGER NOT NULL DEFAULT 0, public INTEGER NOT NULL DEFAULT 0, uploaded TEXT)`,
  `CREATE INDEX IF NOT EXISTS sessions_updated ON sessions (updated DESC)`,
  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY, session TEXT NOT NULL, n INTEGER NOT NULL, kind TEXT NOT NULL, tool TEXT NOT NULL DEFAULT '', at TEXT, text TEXT NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS messages_session ON messages (session, n)`,
  // Full-text search over the messages, kept in step by the two triggers below.
  `CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(text, content='messages', content_rowid='id', tokenize='porter unicode61')`,
  `CREATE TRIGGER IF NOT EXISTS messages_added AFTER INSERT ON messages BEGIN INSERT INTO messages_fts (rowid, text) VALUES (new.id, new.text); END`,
  `CREATE TRIGGER IF NOT EXISTS messages_removed AFTER DELETE ON messages BEGIN INSERT INTO messages_fts (messages_fts, rowid, text) VALUES ('delete', old.id, old.text); END`,
];

// The tables are made the first time each copy of the function uses the database.
const ready = new WeakSet();
async function database(env) {
  const db = env.SESSIONS;
  if (!db) return null;
  if (!ready.has(db)) {
    await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
    ready.add(db);
  }
  return db;
}

// ---------- uploads ----------
/** Compares two secrets without giving away, by timing, how much of a guess was right. */
export async function sameSecret(a, b) {
  const hash = async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s))));
  const [x, y] = await Promise.all([hash(a), hash(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const isoOrNull = (v) => {
  const d = typeof v === "string" || typeof v === "number" ? new Date(v) : null;
  return d && !isNaN(d) ? d.toISOString() : null;
};
const line = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Checks one upload and returns clean values, or an error to send back. */
export function validateUpload(body) {
  if (!body || typeof body !== "object") return { error: "The upload could not be read." };
  if (!SOURCES.includes(body.source)) return { error: "The source must be \"code\" or \"chat\"." };
  if (typeof body.id !== "string" || !ID.test(body.id)) return { error: "That isn't a session ID." };
  const offset = body.offset === undefined ? 0 : body.offset;
  if (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000) return { error: "The offset isn't a whole number." };
  if (!Array.isArray(body.messages)) return { error: "The messages are missing." };
  const messages = [];
  for (const m of body.messages) {
    if (!m || !KINDS.includes(m.kind) || typeof m.text !== "string") return { error: "Each message needs a kind and text." };
    messages.push({ kind: m.kind, tool: line(m.tool, 100), at: isoOrNull(m.at), text: m.text.slice(0, MAX_TEXT) });
  }
  return {
    upload: {
      key: `${body.source}:${body.id}`,
      source: body.source,
      title: line(body.title, 200),
      project: line(body.project, 200),
      started: isoOrNull(body.started),
      updated: isoOrNull(body.updated),
      offset,
      messages,
    },
  };
}

/**
 * Handles POST /api/upload: saves one session, or one part of a long one.
 * The part with offset 0 replaces any earlier copy, so sending a session again is safe.
 */
export async function handleUpload(request, env = {}, now = Date.now()) {
  if (request.method !== "POST") return json(405, { error: "Use POST." });
  if (!env.SESSIONS || !env.ARCHIVE_KEY || env.ARCHIVE_KEY.length < 32) return json(503, { error: "The sessions archive isn't set up yet. See \"Claude sessions archive\" in the README." });
  const sent = /^Bearer (.+)$/.exec(request.headers.get("Authorization") || "")?.[1];
  if (!sent || !(await sameSecret(sent, env.ARCHIVE_KEY))) return json(401, { error: "The archive key is missing or wrong." });

  // Stops reading at a hard byte limit (4 bytes per character at most), then checks characters as before.
  const text = await readText(request, MAX_BODY_BYTES * 4);
  if (text === null || text.length > MAX_BODY_BYTES) return json(413, { error: "That upload is too big. Send the session in smaller parts." });
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { error: "The upload could not be read." });
  }
  const { upload, error } = validateUpload(body);
  if (error) return json(400, { error });

  const db = await database(env);
  const s = upload;
  await db.batch([
    // `public` is left alone when a session is sent again.
    db.prepare(
      `INSERT INTO sessions (id, source, title, project, started, updated, uploaded) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT (id) DO UPDATE SET title = excluded.title, project = excluded.project, started = excluded.started, updated = excluded.updated, uploaded = excluded.uploaded`
    ).bind(s.key, s.source, s.title, s.project, s.started, s.updated, new Date(now).toISOString()),
    db.prepare(`DELETE FROM messages WHERE session = ?1 AND n >= ?2`).bind(s.key, s.offset),
    // One statement adds every message in this part.
    db.prepare(
      `INSERT INTO messages (session, n, kind, tool, at, text)
       SELECT ?1, ?2 + key, json_extract(value, '$.kind'), json_extract(value, '$.tool'), json_extract(value, '$.at'), json_extract(value, '$.text') FROM json_each(?3)`
    ).bind(s.key, s.offset, JSON.stringify(s.messages)),
    // The count shown for a session is its prompts and answers.
    db.prepare(`UPDATE sessions SET messages = (SELECT COUNT(*) FROM messages WHERE session = ?1 AND kind IN ${TALK}) WHERE id = ?1`).bind(s.key),
  ]);
  return json(200, { saved: s.key, messages: s.offset + s.messages.length });
}

// ---------- reading and searching (James only) ----------
/**
 * Turns what was typed into a full-text search: every word must appear, and the
 * start of a word is enough ("swim" finds "swimming"). Words are quoted, so
 * punctuation can't be read as search commands.
 */
export function searchQuery(typed) {
  const words = String(typed || "").slice(0, 200).split(/\s+/).map((w) => w.replace(/"/g, "")).filter((w) => /[\p{L}\p{N}]/u.test(w)).slice(0, 12);
  return words.length ? words.map((w) => `"${w}"*`).join(" ") : null;
}

// Marks around the words found in a search result; the page turns them into highlights.
export const MARK_START = "\u0001";
export const MARK_END = "\u0002";

const sessionRow = (r) => ({ id: r.id, source: r.source, title: r.title, project: r.project, started: r.started, updated: r.updated, messages: r.messages, public: !!r.public });

/**
 * Handles the archive's part of /api/*: sessions (list or search), session
 * (read or delete one) and message (all of one long message). src/index.js has
 * already checked the sign-in.
 */
export async function handleSessions(action, request, env) {
  const url = new URL(request.url);
  if (!env.SESSIONS) return json(503, { error: "The sessions archive isn't set up yet. See \"Claude sessions archive\" in the README." });
  const db = await database(env);
  const source = SOURCES.includes(url.searchParams.get("source")) ? url.searchParams.get("source") : null;
  const from = Math.max(0, Math.min(1_000_000, Number.parseInt(url.searchParams.get("from") || "0", 10) || 0));

  if (action === "sessions" && request.method === "GET") {
    const q = searchQuery(url.searchParams.get("q"));
    if (!q) {
      const { results } = await db.prepare(
        `SELECT * FROM sessions WHERE (?1 IS NULL OR source = ?1) ORDER BY COALESCE(updated, started, uploaded) DESC LIMIT ?2 OFFSET ?3`
      ).bind(source, PAGE + 1, from).all();
      const total = await db.prepare(`SELECT COUNT(*) AS sessions, COALESCE(SUM(messages), 0) AS messages FROM sessions`).first();
      return json(200, { sessions: results.slice(0, PAGE).map(sessionRow), next: results.length > PAGE ? from + PAGE : null, total });
    }
    const { results } = await db.prepare(
      `SELECT m.session, m.n, m.kind, m.tool, m.at, snippet(messages_fts, 0, ?4, ?5, '…', 30) AS snippet, s.title, s.source, s.started
       FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid JOIN sessions s ON s.id = m.session
       WHERE messages_fts MATCH ?1 AND (?2 IS NULL OR s.source = ?2) AND (?7 = 0 OR m.kind IN ${TALK})
       ORDER BY COALESCE(m.at, s.updated, s.started) DESC LIMIT ?3 OFFSET ?6`
    ).bind(q, source, PAGE + 1, MARK_START, MARK_END, from, url.searchParams.get("only") === "talk" ? 1 : 0).all();
    return json(200, {
      results: results.slice(0, PAGE).map((r) => ({ id: r.session, n: r.n, kind: r.kind, tool: r.tool, at: r.at || r.started, snippet: r.snippet, title: r.title, source: r.source })),
      next: results.length > PAGE ? from + PAGE : null,
    });
  }

  if (action === "session" || action === "message") {
    const id = url.searchParams.get("id") || "";
    const [src, rest] = [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)];
    if (!SOURCES.includes(src) || !ID.test(rest)) return json(400, { error: "That isn't a session." });
    if (action === "message") {
      if (request.method !== "GET" || !/^\d{1,7}$/.test(url.searchParams.get("n") || "")) return json(400, { error: "That isn't a message." });
      const message = await db.prepare(`SELECT n, kind, tool, at, text FROM messages WHERE session = ?1 AND n = ?2`).bind(id, Number(url.searchParams.get("n"))).first();
      return message ? json(200, message) : json(404, { error: "That message isn't in the archive." });
    }
    if (request.method === "GET") {
      const session = await db.prepare(`SELECT * FROM sessions WHERE id = ?1`).bind(id).first();
      if (!session) return json(404, { error: "That session isn't in the archive." });
      // Prompts and answers are sent whole. The rest can be very long, so only the start is sent.
      const { results } = await db.prepare(
        `SELECT n, kind, tool, at, CASE WHEN kind IN ${TALK} THEN text ELSE substr(text, 1, ?4) END AS text, length(text) AS length
         FROM messages WHERE session = ?1 AND n >= ?2 ORDER BY n LIMIT ?3`
      ).bind(id, from, MESSAGES_PAGE + 1, PREVIEW).all();
      return json(200, { session: sessionRow(session), messages: results.slice(0, MESSAGES_PAGE), next: results.length > MESSAGES_PAGE ? from + MESSAGES_PAGE : null });
    }
    if (request.method === "DELETE") {
      await db.batch([db.prepare(`DELETE FROM messages WHERE session = ?1`).bind(id), db.prepare(`DELETE FROM sessions WHERE id = ?1`).bind(id)]);
      return json(200, { deleted: id });
    }
  }
  return json(404, { error: "Not found." });
}
