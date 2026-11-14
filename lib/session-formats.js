// Reads the two kinds of saved Claude conversation into one simple shape for the
// sessions archive (lib/sessions.js): { source, id, title, project, started, updated, messages }.
// Only James's prompts and Claude's answers are kept: no tool calls, tool results or thinking.
//
// Neither format is promised to stay the same, so both readers skip anything they don't recognise.

/** Text Claude Code adds to prompts itself, which James didn't type. */
const tidy = (text) =>
  String(text || "")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<local-command-(stdout|stderr|caveat)>[\s\S]*?<\/local-command-\1>/g, "")
    .trim();

const blocksText = (content) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n\n")
      : "";

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
    const text = tidy(blocksText(entry.message?.content));
    if (!text) continue; // for example a line holding only a tool call or its result
    if (!project && typeof entry.cwd === "string") project = entry.cwd.split(/[\\/]/).filter(Boolean).pop() || "";
    const at = typeof entry.timestamp === "string" ? entry.timestamp : null;
    if (at) { started ??= at; updated = at; }
    const last = messages[messages.length - 1];
    // Claude's answer often arrives in pieces, with tool calls between them: keep it as one answer.
    if (entry.type === "assistant" && last?.role === "assistant") last.text += "\n\n" + text;
    else messages.push({ role: entry.type, at, text });
  }
  const firstPrompt = messages.find((m) => m.role === "user");
  return { source: "code", id: id || fallbackId, title: title || firstLine(firstPrompt?.text), project, started, updated, messages };
}

/** The conversations.json file from a claude.ai data export: a list of chats. */
export function parseClaudeExport(conversations) {
  if (!Array.isArray(conversations)) return [];
  return conversations.map((c) => {
    const messages = [];
    for (const m of Array.isArray(c?.chat_messages) ? c.chat_messages : []) {
      const role = m?.sender === "human" ? "user" : m?.sender === "assistant" ? "assistant" : null;
      const text = (blocksText(m?.content) || (typeof m?.text === "string" ? m.text : "")).trim();
      if (role && text) messages.push({ role, at: typeof m.created_at === "string" ? m.created_at : null, text });
    }
    return {
      source: "chat",
      id: String(c?.uuid || ""),
      title: String(c?.name || "").trim() || firstLine(messages.find((m) => m.role === "user")?.text),
      project: "",
      started: c?.created_at || messages[0]?.at || null,
      updated: c?.updated_at || messages[messages.length - 1]?.at || null,
      messages,
    };
  }).filter((s) => s.id && s.messages.length);
}

/** Splits a session's messages into uploads small enough for /api/sessions. */
export function uploadParts(session, maxChars = 400_000) {
  const { messages, ...about } = session;
  const parts = [];
  let part = [], size = 0, offset = 0;
  for (const m of messages) {
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
