// Reads the two kinds of saved Claude conversation into one simple shape for the
// sessions archive (lib/sessions.js): { source, id, title, project, started, updated, messages }.
// Each message has a kind: "prompt" (James), "answer" (Claude), "thinking" (Claude's saved
// summary of its thinking), "tool" (a tool Claude used, and what it sent), "result" (what came back)
// or "file" (the text of a file James attached to a chat).
//
// Neither format is promised to stay the same, so both readers skip anything they don't recognise.

/** Text Claude Code adds to prompts itself, which James didn't type. */
const tidy = (text) =>
  String(text || "")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<local-command-(stdout|stderr|caveat)>[\s\S]*?<\/local-command-\1>/g, "")
    .trim();

const MAX_TEXT = 200_000; // the archive's limit for one message
const fit = (text) => (text.length > MAX_TEXT ? text.slice(0, MAX_TEXT - 40) + "\n\n[The rest was too long to save.]" : text);

// ---------- secrets ----------
// Tool calls and results hold file contents and command output, which can hold keys and
// passwords. Anything that looks like one is replaced before a session leaves the computer.
// This is a safety net, not a guarantee: a secret in an unusual form will get through.
export const REMOVED = "[secret removed]";

// A setting whose name says it is secret, as in a .env or JSON file: RESEND_API_KEY=…, "password": "…"
const SECRET_WORD = "SECRET|TOKEN|PASSWORD|PASSWD|API[_-]?KEY|PRIVATE[_-]?KEY|ACCESS[_-]?KEY";
const VALUE = String.raw`"([^"\n]{8,})"|'([^'\n]{8,})'|\\"([^"\\\n]{8,})\\"|([^\s"'\\,;]{8,})`;
// In capitals, with or without quotation marks (SESSION_SECRET=…). Any name ending _KEY counts too.
const NAMED = new RegExp(String.raw`\b([A-Z0-9_]*(?:${SECRET_WORD}|_KEY)[A-Z0-9_]*\\?["']?\s*[=:]\s*)(?:${VALUE})`, "g");
// In any case, when the name is in quotation marks ("apiKey": "…").
const QUOTED = new RegExp(String.raw`(["'][\w-]*(?:${SECRET_WORD})[\w-]*\\?["']\s*:\s*)(?:${VALUE})`, "gi");
// Code that reads a secret from somewhere else holds no secret itself: process.env.KEY, $KEY, read(…)
const isCode = (value) => /^\$|\(|^[A-Za-z_]\w*\.[A-Za-z_]/.test(value);
const named = (match, name, double, single, escaped, bare) => {
  if (bare !== undefined) return isCode(bare) || bare.startsWith("[secret") ? match : name + REMOVED;
  return double !== undefined ? `${name}"${REMOVED}"` : single !== undefined ? `${name}'${REMOVED}'` : `${name}\\"${REMOVED}\\"`;
};

const SECRETS = [
  // Private keys (SSH and TLS), whether the line breaks are real or written as \n.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----(?:[A-Za-z0-9+/=\s]|\\[nr])*(?:-----END [A-Z ]*PRIVATE KEY-----)?/g,
  // Keys with a known start: Anthropic and OpenAI, GitHub, Resend, Slack, AWS, Google, Stripe, npm.
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bre_[A-Za-z0-9]{6,12}_[A-Za-z0-9]{16,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bAIza[A-Za-z0-9_-]{35}/g,
  /\b(?:[sr]k_(?:live|test)|whsec)_[A-Za-z0-9]{16,}/g,
  /\bnpm_[A-Za-z0-9]{36}/g,
  // More keys with a known start, from the rules gitleaks uses: GitLab, Hugging Face,
  // DigitalOcean, Shopify, SendGrid, Twilio, Google sign-in secrets, Tailscale, PyPI, Postman,
  // Doppler, Telegram bots, Mailgun.
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bhf_[A-Za-z0-9]{30,}/g,
  /\bdo[opr]_v1_[a-f0-9]{64}/g,
  /\bshp(?:at|ca|pa|ss)_[a-fA-F0-9]{32}/g,
  /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,
  /\bSK[0-9a-f]{32}\b/g,
  /\bGOCSPX-[A-Za-z0-9_-]{20,}/g,
  /\btskey-[A-Za-z0-9-]{20,}/g,
  /\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,}/g,
  /\bPMAK-[a-f0-9]{24}-[a-f0-9]{34}/g,
  /\bdp\.(?:st|sa|ct|scim|audit)\.[A-Za-z0-9_.-]{40,}/g,
  /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/g,
  /\bkey-[a-f0-9]{32}\b/g,
  // Sign-in tokens in three parts (JWTs).
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];

// ---------- random-looking strings ----------
// Most keys have no known start (Cloudflare API tokens, the archive key, many passwords), but
// they look random: a long run of capitals, small letters and digits mixed together. This finds
// those by measuring how unpredictable the characters are (Shannon entropy), as gitleaks and
// trufflehog do. Hex strings (commit IDs, SHA-256 fingerprints, database IDs) are left alone:
// they are common in sessions, useful to keep, and almost never secret on their own.
// A run of letters, digits and + / _ -, with optional = padding at the end. It may follow = or ?,
// so a random value in a web address (?access_token=…) is caught too.
const RANDOM_CANDIDATE = /(?<![A-Za-z0-9+/_.-])[A-Za-z0-9+/_-]{32,}={0,2}(?![A-Za-z0-9+/_=-])/g;
const MIN_ENTROPY = 4.2; // bits per character; English words and code names score well below this

/** How unpredictable the characters in a string are, in bits per character. */
export function entropy(s) {
  const counts = new Map();
  for (const c of s) counts.set(c, (counts.get(c) || 0) + 1);
  let bits = 0;
  for (const n of counts.values()) bits -= (n / s.length) * Math.log2(n / s.length);
  return bits;
}

/** Whether a string looks like a random key rather than a word, a path or a hex fingerprint. */
export function looksRandom(s) {
  const core = s.replace(/=+$/, "");
  if (core.length < 32) return false;
  if (!/[A-Z]/.test(core) || !/[a-z]/.test(core) || !/[0-9]/.test(core)) return false;
  // Words joined by -, _ or / (file paths, long-file-names_like_this) are not keys.
  if (core.split(/[-_/]/).every((part) => /^[A-Za-z]*\d{0,4}$/.test(part))) return false;
  // Names made of whole words (CamelCaseNamesLikeThis2) have long runs of small letters;
  // random keys switch between capitals, small letters and digits every one or two characters.
  const runs = core.match(/[a-z]+/g) || [];
  if (runs.join("").length / runs.length >= 3.5) return false;
  return entropy(core) >= MIN_ENTROPY;
}

const randomStrings = (text) =>
  text.replace(RANDOM_CANDIDATE, (match) =>
    // Subresource integrity and lockfile fingerprints (sha384-…) are public, not secret.
    /^sha(?:1|256|384|512)-/.test(match) || !looksRandom(match) ? match : REMOVED,
  );

/** Replaces anything in the text that looks like a key, token or password. */
export function redact(text) {
  let out = String(text ?? "").replace(NAMED, named).replace(QUOTED, named);
  for (const secret of SECRETS) out = out.replace(secret, REMOVED);
  out = randomStrings(out);
  return out
    // What is sent to prove who you are: "Authorization: Bearer …" and "Authorization: Basic …"
    .replace(/\b(Bearer\s+|Authorization:\s*Basic\s+)[A-Za-z0-9._~+/=-]{20,}/g, `$1${REMOVED}`)
    // A password inside a web address: https://name:password@example.com
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@"']+:)[^\s@/"']{3,}(@)/gi, `$1${REMOVED}$2`);
}

/** One piece of what a tool sent back. */
function resultPart(b) {
  if (!b || typeof b !== "object") return "";
  if (b.type === "text" && typeof b.text === "string") return b.text;
  // A web page or search result, in a claude.ai export.
  if (b.type === "knowledge") return [b.title, b.url, b.text].filter((v) => typeof v === "string" && v.trim()).join("\n");
  if (b.type === "local_resource") return `[File: ${b.file_path || b.name || "unnamed"}]`;
  return b.type ? `[${b.type}]` : "";
}

/** What a tool sent back: text, or a list of text and other blocks. */
const resultText = (content) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map(resultPart).filter(Boolean).join("\n\n")
      : content == null ? "" : JSON.stringify(content, null, 2);

/**
 * Claude's thinking. When the full text isn't kept, claude.ai exports keep short
 * summaries of it instead.
 */
function thinkingText(b) {
  if (typeof b.thinking === "string" && b.thinking.trim()) return b.thinking.trim();
  if (!Array.isArray(b.summaries)) return "";
  return b.summaries.map((s) => (s && typeof s.summary === "string" ? s.summary.trim() : "")).filter(Boolean).join("\n");
}

/**
 * Turns one saved message into the archive's messages. `mine` says whether James sent it.
 * `tools` remembers each tool call's name, so its result can be labelled with it.
 */
function items(content, mine, tools) {
  const blocks = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
  const out = [];
  for (const b of blocks) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "text" && typeof b.text === "string") {
      const text = mine ? tidy(b.text) : b.text.trim();
      const last = out[out.length - 1];
      if (!text) continue;
      if (last && last.kind === (mine ? "prompt" : "answer")) last.text += "\n\n" + text;
      else out.push({ kind: mine ? "prompt" : "answer", text });
    } else if (b.type === "thinking") {
      const text = thinkingText(b);
      if (text) out.push({ kind: "thinking", text });
    } else if (b.type === "tool_use") {
      const name = String(b.name || "tool");
      if (b.id) tools.set(b.id, name);
      out.push({ kind: "tool", tool: name, text: typeof b.input === "string" ? b.input : JSON.stringify(b.input ?? {}, null, 2) });
    } else if (b.type === "tool_result") {
      const text = resultText(b.content).trim();
      out.push({ kind: "result", tool: tools.get(b.tool_use_id) || String(b.name || ""), text: text || "[nothing]" });
    }
  }
  return out.map((m) => ({ ...m, text: fit(redact(m.text)) }));
}

/** Adds messages to a session, joining an answer to the answer straight before it. */
function add(messages, more, at) {
  for (const m of more) {
    const last = messages[messages.length - 1];
    if (m.kind === "answer" && last?.kind === "answer") last.text = fit(last.text + "\n\n" + m.text);
    else messages.push({ ...m, at });
  }
}

const firstLine = (text, max = 80) => {
  const line = String(text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return line.length > max ? line.slice(0, max - 1).trimEnd() + "…" : line;
};

/**
 * A Claude Code transcript: a .jsonl file with one JSON object per line.
 * `fallbackId` is used when no line names the session (normally the file name).
 */
export function parseClaudeCode(jsonl, fallbackId = "") {
  const messages = [];
  const tools = new Map();
  let id = "", title = "", project = "", started = null, updated = null;
  for (const raw of String(jsonl).split("\n")) {
    if (!raw.trim()) continue;
    let entry;
    try { entry = JSON.parse(raw); } catch { continue; }
    if (!entry || typeof entry !== "object") continue;
    if (!id && typeof entry.sessionId === "string") id = entry.sessionId;
    // Names given by /rename, or written by Claude Code itself. The last one wins.
    for (const key of ["customTitle", "aiTitle", "summary"]) if (typeof entry[key] === "string" && entry[key].trim() && /title|summary/.test(entry.type || "")) title = entry[key].trim();
    if (entry.type !== "user" && entry.type !== "assistant") continue;
    if (entry.isSidechain || entry.isMeta) continue; // subagents' own conversations, and notes James didn't type
    const found = items(entry.message?.content, entry.type === "user", tools);
    if (!found.length) continue;
    if (!project && typeof entry.cwd === "string") project = entry.cwd.split(/[\\/]/).filter(Boolean).pop() || "";
    const at = typeof entry.timestamp === "string" ? entry.timestamp : null;
    if (at) { started ??= at; updated = at; }
    add(messages, found, at);
  }
  const firstPrompt = messages.find((m) => m.kind === "prompt");
  return { source: "code", id: id || fallbackId, title: redact(title) || firstLine(firstPrompt?.text), project, started, updated, messages };
}

/** The conversations.json file from a claude.ai data export: a list of chats. */
export function parseClaudeExport(conversations) {
  if (!Array.isArray(conversations)) return [];
  return conversations.map((c) => {
    const messages = [];
    const tools = new Map();
    for (const m of Array.isArray(c?.chat_messages) ? c.chat_messages : []) {
      if (m?.sender !== "human" && m?.sender !== "assistant") continue;
      const mine = m.sender === "human";
      let found = items(m.content, mine, tools);
      // Older exports have only the plain text of each message.
      if (!found.length && typeof m.text === "string" && m.text.trim()) found = items(m.text, mine, tools);
      // Files James attached, where the export kept their text.
      for (const a of Array.isArray(m.attachments) ? m.attachments : []) {
        const text = typeof a?.extracted_content === "string" ? a.extracted_content.trim() : "";
        if (text) found.push({ kind: "file", tool: String(a.file_name || "").slice(0, 100), text: fit(redact(text)) });
      }
      add(messages, found, typeof m.created_at === "string" ? m.created_at : null);
    }
    return {
      source: "chat",
      id: String(c?.uuid || ""),
      title: redact(String(c?.name || "").trim()) || firstLine(messages.find((m) => m.kind === "prompt")?.text),
      project: "",
      started: c?.created_at || messages[0]?.at || null,
      updated: c?.updated_at || messages[messages.length - 1]?.at || null,
      messages,
    };
  }).filter((s) => s.id && s.messages.length);
}

/** Splits a session's messages into uploads small enough for /api/sessions. */
// Kept small, so each upload is quick for the site to handle.
// `start` skips the messages before it, which the archive already has.
export function uploadParts(session, maxChars = 150_000, start = 0) {
  const { messages, ...about } = session;
  const parts = [];
  let part = [], size = 0, offset = start;
  for (const m of messages.slice(start)) {
    const length = m.text.length + 100;
    if (part.length && size + length > maxChars) {
      parts.push({ ...about, offset, messages: part });
      offset += part.length;
      part = [];
      size = 0;
    }
    part.push(m);
    size += length;
  }
  parts.push({ ...about, offset, messages: part });
  return parts;
}
