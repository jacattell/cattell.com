import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateMessages, RateLimiter, handleChat } from "../lib/chat.js";

test("accepts a normal conversation", () => {
  const { messages, error } = validateMessages({
    messages: [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi" },
      { role: "user", content: "Who is James?" },
    ],
  });
  assert.equal(error, undefined);
  assert.equal(messages.length, 3);
});

test("rejects bad conversations", () => {
  assert.ok(validateMessages({}).error);
  assert.ok(validateMessages({ messages: [] }).error);
  assert.ok(validateMessages({ messages: [{ role: "assistant", content: "Hi" }] }).error);
  assert.ok(validateMessages({ messages: [{ role: "system", content: "Hi" }] }).error);
  assert.ok(validateMessages({ messages: [{ role: "user", content: "x".repeat(2001) }] }).error);
  assert.ok(validateMessages({ messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }] }).error);
  const long = Array.from({ length: 21 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "x" }));
  assert.ok(validateMessages({ messages: long }).error);
  const endsWithAssistant = [
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi" },
  ];
  assert.ok(validateMessages({ messages: endsWithAssistant }).error);
});

test("drops extra fields from messages", () => {
  const { messages } = validateMessages({ messages: [{ role: "user", content: "Hi", extra: 1 }] });
  assert.deepEqual(messages, [{ role: "user", content: "Hi" }]);
});

test("rate limiter blocks after the limit and recovers", () => {
  let now = 0;
  const limiter = new RateLimiter(2, 1000, () => now);
  assert.equal(limiter.allow("a"), true);
  assert.equal(limiter.allow("a"), true);
  assert.equal(limiter.allow("a"), false);
  assert.equal(limiter.allow("b"), true);
  now = 1001;
  assert.equal(limiter.allow("a"), true);
});

test("chat says it is not set up when there is no API key", async () => {
  const req = new Request("https://example.com/api/chat", { method: "POST", body: "{}" });
  const res = await handleChat(req, {});
  assert.equal(res.status, 503);
});

test("chat only accepts POST", async () => {
  const res = await handleChat(new Request("https://example.com/api/chat"), { ANTHROPIC_API_KEY: "x" });
  assert.equal(res.status, 405);
});

test("old Google Sites addresses have redirects", () => {
  const rules = fs.readFileSync("_site/_redirects", "utf8");
  assert.match(rules, /^\/week-notes\/2026-week-7 \/week-notes\/2026\/07\/ 301$/m);
  assert.match(rules, /^\/week-notes\/2026-week-07 \/week-notes\/2026\/07\/ 301$/m);
  assert.match(rules, /^\/week-notes\/2025-week-09 \/week-notes\/2025\/09\/ 301$/m);
  assert.match(rules, /^\/week-notes\/2024-week-46 \/week-notes\/2024\/46\/ 301$/m);
  assert.match(rules, /^\/james \/ 301$/m);
});

test("pages load CSS and scripts with a version, so browsers do not use old copies", () => {
  const home = fs.readFileSync("_site/index.html", "utf8");
  assert.match(home, /href="\/assets\/css\/site\.css\?v=[0-9a-f]{8}"/);
  assert.match(home, /src="\/assets\/js\/theme\.js\?v=[0-9a-f]{8}"/);
  const chat = fs.readFileSync("_site/chat/index.html", "utf8");
  assert.match(chat, /src="\/assets\/js\/chat\.js\?v=[0-9a-f]{8}"/);
});

test("every page footer has the links, licence and copyright", () => {
  for (const page of ["_site/index.html", "_site/week-notes/2026/14/index.html", "_site/404.html"]) {
    const html = fs.readFileSync(page, "utf8");
    const footer = html.slice(html.indexOf("<footer"));
    const text = footer.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    assert.match(text, /Contact me · Week notes feed · Source on GitHub/, page);
    assert.match(footer, /© James Arthur Cattell\. All content is available under the <a href="https:\/\/creativecommons\.org\/licenses\/by-sa\/4\.0\/" rel="license">Creative Commons BY-SA 4\.0<\/a> licence, except where otherwise stated<\/p>/, page);
  }
});
