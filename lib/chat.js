// The "Chat with Claude" endpoint, POST /api/chat.
// Runs as a Cloudflare Pages Function (see functions/api/chat.js).
import Anthropic from "@anthropic-ai/sdk";

const MAX_MESSAGES = 20; // per conversation
const MAX_CHARS = 2000; // per message
const MAX_BODY_BYTES = 64 * 1024;

const SYSTEM_PROMPT = `You are Claude, an AI assistant made by Anthropic. You are answering visitors on the "Chat with Claude" page of cattell.com, the personal website of James Arthur Cattell.

Visitors may ask about James and his website, or about anything else. A copy of the main pages of the website is below. Use it to answer questions about James, and link to the relevant page when that helps.

You are not James and you do not speak for him. If the website does not answer a question about him, say you don't know and point the visitor to the contact page. Do not guess facts about James or about anyone named in his week notes.

Replies are shown as plain text in a small chat box, so write plain text without Markdown, keep answers short, and use simple, clear language. Write web addresses in full.`;

/** Checks the conversation sent by the browser. Returns { messages } or { error }. */
export function validateMessages(body) {
  const list = body && body.messages;
  if (!Array.isArray(list) || list.length === 0) return { error: "No message was sent." };
  if (list.length > MAX_MESSAGES) {
    return { error: "This conversation is too long. Choose Start again to begin a new one." };
  }
  const messages = [];
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    const expected = i % 2 === 0 ? "user" : "assistant";
    if (!m || m.role !== expected || typeof m.content !== "string" || !m.content.trim()) {
      return { error: "The conversation was not in the right format." };
    }
    if (m.role === "user" && m.content.length > MAX_CHARS) {
      return { error: `Messages can be up to ${MAX_CHARS} characters.` };
    }
    messages.push({ role: m.role, content: m.content });
  }
  if (messages.at(-1).role !== "user") return { error: "The conversation was not in the right format." };
  return { messages };
}

/**
 * Counts requests in a time window, per key.
 * Cloudflare runs many copies of the function, each with its own memory, so this
 * only slows down one busy visitor. The firm limits are the Cloudflare rate
 * limiting rule and the spend limit on the API key (see README).
 */
export class RateLimiter {
  constructor(limit, windowMs, now = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.hits = new Map();
  }
  /** Records a request and returns true if it is allowed. */
  allow(key) {
    const now = this.now();
    const recent = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10000) this.prune();
    return true;
  }
  prune() {
    const now = this.now();
    for (const [key, times] of this.hits) {
      if (!times.some((t) => now - t < this.windowMs)) this.hits.delete(key);
    }
  }
}

const perMinute = new RateLimiter(6, 60 * 1000);
const perDay = new RateLimiter(40, 24 * 60 * 60 * 1000);

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function loadContext(request, env) {
  if (!env.ASSETS) return "";
  try {
    const res = await env.ASSETS.fetch(new URL("/chat-context.txt", request.url));
    return res.ok ? (await res.text()).trim() : "";
  } catch {
    return "";
  }
}

/** Handles POST /api/chat. `env` holds the Cloudflare settings and bindings. */
export async function handleChat(request, env = {}) {
  if (request.method !== "POST") return json(405, { error: "Use POST." });
  if (!env.ANTHROPIC_API_KEY) return json(503, { error: "Chat is not set up yet." });

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!perMinute.allow(ip)) return json(429, { error: "Please wait a minute before sending more messages." });
  if (!perDay.allow(ip)) return json(429, { error: "You have reached today's message limit. Please come back tomorrow." });

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json(413, { error: "The message is too long." });
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { error: "The request could not be read." });
  }
  const { messages, error } = validateMessages(body);
  if (error) return json(400, { error });

  const context = await loadContext(request, env);
  const system = context ? `${SYSTEM_PROMPT}\n\n<website>\n${context}\n</website>` : SYSTEM_PROMPT;

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const stream = client.beta.messages.stream({
    model: env.CHAT_MODEL || "claude-haiku-5-5",
    max_tokens: 2048, // short chat replies; also limits cost per message
    system,
    messages,
    output_config: { effort: "low" },
    // If the model declines a request, let the API retry it on a fallback model.
    // Models without a fallback (such as Claude Haiku 5.5) ignore this.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  let open = true;
  const send = (data) => {
    if (!open) return;
    writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)).catch(() => {
      // The visitor left the page: stop asking Claude for more.
      open = false;
      stream.abort();
    });
  };

  const done = (async () => {
    try {
      stream.on("text", (t) => send({ text: t }));
      const message = await stream.finalMessage();
      send(message.stop_reason === "refusal" ? { error: "Sorry, Claude can't help with that request." } : { done: true });
    } catch (err) {
      if (err instanceof Anthropic.APIUserAbortError) return;
      if (err instanceof Anthropic.RateLimitError) {
        send({ error: "Chat is busy right now. Please try again in a minute." });
      } else if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        console.error("Chat: the API key was rejected.");
        send({ error: "Chat is not set up correctly. Please tell James." });
      } else if (err instanceof Anthropic.APIError) {
        console.error(`Chat: API error ${err.status}: ${err.message}`);
        send({ error: "Sorry, something went wrong. Please try again." });
      } else {
        console.error("Chat: unexpected error", err);
        send({ error: "Sorry, something went wrong. Please try again." });
      }
    } finally {
      open = false;
      writer.close().catch(() => {});
    }
  })();

  return {
    response: new Response(readable, {
      headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" },
    }),
    done,
  };
}
