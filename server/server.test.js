import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { validateMessages, RateLimiter } from "./chat.js";
import { oldUrlRedirect, resolveFile } from "./static.js";

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

test("redirects old Google Sites addresses", () => {
  assert.equal(oldUrlRedirect("/week-notes/2026-week-7"), "/week-notes/2026/07/");
  assert.equal(oldUrlRedirect("/week-notes/2025-week-09/"), "/week-notes/2025/09/");
  assert.equal(oldUrlRedirect("/week-notes/2022/2022-week-39"), "/week-notes/2022/39/");
  assert.equal(oldUrlRedirect("/james"), "/");
  assert.equal(oldUrlRedirect("/week-notes/2026/07/"), null);
  assert.equal(oldUrlRedirect("/delivery"), null);
});

test("never serves files outside the site folder", () => {
  const root = path.resolve("/srv/site");
  assert.equal(resolveFile(root, "/delivery/"), path.join(root, "delivery"));
  assert.equal(resolveFile(root, "/../etc/passwd"), path.join(root, "etc/passwd"));
  assert.equal(resolveFile(root, "/..%2f..%2fetc/passwd"), path.join(root, "etc/passwd"));
  assert.equal(resolveFile(root, "/%00"), null);
  assert.equal(resolveFile(root, "/%E0%A4%A"), null);
});
