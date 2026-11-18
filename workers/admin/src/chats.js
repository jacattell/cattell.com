// The chat logs from "Ask my AI" (kept 30 days in KV by the public Worker): /api/chats and /api/chat.
import { json } from "../../shared/http.js";

export async function handleChats(action, request, env) {
  const url = new URL(request.url);
  if (!env.CHAT_LOGS) return json(503, { error: "Chat logs aren't set up yet." });
  if (action === "chats") {
    const page = await env.CHAT_LOGS.list({ prefix: "conv:", limit: 50, cursor: url.searchParams.get("cursor") || undefined });
    const chats = await Promise.all(page.keys.map(async (k) => {
      const id = k.name.slice(5);
      let summary = k.metadata && k.metadata.started && k.metadata.turns ? k.metadata : null;
      if (!summary) {
        const record = await env.CHAT_LOGS.get(k.name, "json").catch(() => null);
        summary = record?.turns?.length ? { started: record.started, updated: record.updated, turns: record.turns.length, first: String(record.turns[0].q || "").slice(0, 150) } : {};
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
  if (action === "chat") {
    const id = url.searchParams.get("id") || "";
    if (!/^\d{13}-[a-z0-9]{8}$/.test(id)) return json(400, { error: "That isn't a conversation." });
    const record = await env.CHAT_LOGS.get(`conv:${id}`, "json");
    return record ? json(200, record) : json(404, { error: "That conversation has been deleted." });
  }
  return json(404, { error: "Not found." });
}
