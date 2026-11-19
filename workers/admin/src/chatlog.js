// The "Ask my AI" chat logs, kept in KV (CHAT_LOGS) for 30 days with no IP addresses.
// Only this Worker has the KV binding. The public Worker (api.cattell.com) reaches it
// through the ChatLogs entrypoint (src/entry.js), which can only add a conversation and
// count today's messages. It has no way to read, list or delete logs.

export const LOG_DAYS = 30;
export const DAILY_CAP = 500; // messages a day from everyone together, unless CHAT_DAILY_CAP says otherwise
const CONVERSATION_ID = /^(\d{13})-([a-z0-9]{8})$/;
const MAX_MESSAGES = 20;
const MAX_QUESTION = 2000;
const MAX_ANSWER = 20000;

/** The page makes a conversation ID from its start time, counted down from 10^13. Returns the start time, or null. */
export function conversationStart(id, now = Date.now()) {
  const m = CONVERSATION_ID.exec(String(id || ""));
  if (!m) return null;
  const started = 1e13 - Number(m[1]);
  return started > now - 2 * 86400e3 && started < now + 5 * 60e3 ? started : null;
}

/** Checks what the public Worker sends, in case it was ever taken over: only a well-formed conversation is saved. */
export function validLog(messages, reply) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > MAX_MESSAGES || messages.length % 2 !== 1) return false;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const role = i % 2 === 0 ? "user" : "assistant";
    if (!m || m.role !== role || typeof m.content !== "string") return false;
    if (m.content.length > (role === "user" ? MAX_QUESTION : MAX_ANSWER)) return false;
  }
  return typeof reply === "string" && reply.length <= MAX_ANSWER;
}

/** Saves the whole conversation so far, replacing the previous copy. Deleted by Cloudflare after LOG_DAYS. */
export async function logConversation(kv, id, messages, reply, now = Date.now()) {
  const started = conversationStart(id, now);
  if (!kv || started === null || !validLog(messages, reply)) return false;
  const all = [...messages, { role: "assistant", content: reply }];
  const turns = [];
  for (let i = 0; i < all.length; i += 2) turns.push({ q: all[i].content, a: all[i + 1]?.content ?? "" });
  const record = { started: new Date(started).toISOString(), updated: new Date(now).toISOString(), turns };
  await kv.put(`conv:${id}`, JSON.stringify(record), {
    expirationTtl: LOG_DAYS * 86400,
    metadata: { started: record.started, updated: record.updated, turns: turns.length, first: turns[0].q.slice(0, 150) },
  });
  return true;
}

/**
 * Counts today's messages from everyone and says whether one more is allowed.
 * KV has no atomic counter, so many messages at the same moment can go slightly over the cap.
 * The Anthropic account's monthly spend limit is the firm backstop.
 */
export async function allowMessage(kv, cap = DAILY_CAP, now = Date.now()) {
  if (!kv) return false;
  const key = `count:${new Date(now).toISOString().slice(0, 10)}`;
  const count = Number(await kv.get(key)) || 0;
  if (count >= cap) return false;
  await kv.put(key, String(count + 1), { expirationTtl: 2 * 86400 });
  return true;
}

/** What the ChatLogs entrypoint does. Returns only true or false: nothing stored is ever sent back. */
export const chatLogMethods = (env) => ({
  allow: () => allowMessage(env.CHAT_LOGS, Number(env.CHAT_DAILY_CAP) || DAILY_CAP),
  save: (data) => logConversation(env.CHAT_LOGS, data && data.conversation, data && data.messages, data && data.reply),
});
