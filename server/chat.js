// The "Chat with Claude" endpoint: POST /api/chat
import fs from "node:fs";
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

/** Counts requests in a time window, per key. Kept in memory. */
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

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

export function createChatHandler({ contextFile, env = process.env } = {}) {
  const model = env.CHAT_MODEL || "claude-opus-5-5";
  const perMinute = new RateLimiter(Number(env.CHAT_PER_MINUTE || 6), 60 * 1000);
  const perDay = new RateLimiter(Number(env.CHAT_PER_DAY || 40), 24 * 60 * 60 * 1000);
  // A cap on all visitors together, so a busy day cannot run up a large bill.
  const everyone = new RateLimiter(Number(env.CHAT_DAILY_LIMIT || 300), 24 * 60 * 60 * 1000);

  let system = SYSTEM_PROMPT;
  if (contextFile && fs.existsSync(contextFile)) {
    system += "\n\n<website>\n" + fs.readFileSync(contextFile, "utf8").trim() + "\n</website>";
  }

  const client = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;

  return async function handleChat(req, res) {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Use POST." });
    if (!client) return sendJson(res, 503, { error: "Chat is not set up yet." });

    const ip = clientIp(req);
    if (!perMinute.allow(ip)) return sendJson(res, 429, { error: "Please wait a minute before sending more messages." });
    if (!perDay.allow(ip)) return sendJson(res, 429, { error: "You have reached today's message limit. Please come back tomorrow." });
    if (!everyone.allow("all")) return sendJson(res, 429, { error: "Chat has reached its limit for today. Please come back tomorrow." });

    let body;
    try {
      body = await readJson(req);
    } catch {
      return sendJson(res, 400, { error: "The request could not be read." });
    }
    const { messages, error } = validateMessages(body);
    if (error) return sendJson(res, 400, { error });

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    });
    const event = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    const stream = client.beta.messages.stream({
      model,
      max_tokens: 2048, // short chat replies; also limits cost per message
      system,
      messages,
      output_config: { effort: "low" },
      // If the model declines a request, let the API retry it on its default fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    res.on("close", () => {
      if (!res.writableEnded) stream.abort();
    });

    try {
      stream.on("text", (text) => event({ text }));
      const message = await stream.finalMessage();
      if (message.stop_reason === "refusal") {
        event({ error: "Sorry, Claude can't help with that request." });
      } else {
        event({ done: true });
      }
    } catch (err) {
      if (err instanceof Anthropic.APIUserAbortError) return;
      if (err instanceof Anthropic.RateLimitError) {
        event({ error: "Chat is busy right now. Please try again in a minute." });
      } else if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        console.error("Chat: the API key was rejected.");
        event({ error: "Chat is not set up correctly. Please tell James." });
      } else if (err instanceof Anthropic.APIError) {
        console.error(`Chat: API error ${err.status}: ${err.message}`);
        event({ error: "Sorry, something went wrong. Please try again." });
      } else {
        console.error("Chat: unexpected error", err);
        event({ error: "Sorry, something went wrong. Please try again." });
      }
    } finally {
      res.end();
    }
  };
}
