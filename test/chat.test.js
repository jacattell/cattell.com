import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateMessages, RateLimiter, handleChat, buildSystem } from "../lib/chat.js";

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

test("every page has a share panel with that page's address", () => {
  const html = fs.readFileSync("_site/week-notes/2026/14/index.html", "utf8");
  const page = encodeURIComponent("https://www.cattell.com/week-notes/2026/14/");
  assert.match(html, /<details class="share" data-url="https:\/\/www\.cattell\.com\/week-notes\/2026\/14\/"/);
  assert.ok(html.includes(`https://www.linkedin.com/sharing/share-offsite/?url=${page}`));
  assert.ok(html.includes(`https://www.facebook.com/sharer/sharer.php?u=${page}`));
  assert.match(html, /bsky\.app\/intent\/compose\?text=Week%2014%2C%202026%20-%20James%20Arthur%20Cattell%20https/);
  assert.ok(!fs.readFileSync("_site/404.html", "utf8").includes('class="share"'), "no share panel on the 404 page");
});

test("the Unconference page lists the chapters and blog posts", () => {
  const html = fs.readFileSync("_site/unconference/index.html", "utf8");
  assert.match(html, /<h2>Blog posts<\/h2>/);
  assert.ok(html.includes('<a href="/unconference/how-an-unconference-is-different-from-a-conference/">How an unconference is different from a conference</a>'));
  assert.ok(html.includes('<a href="/unconference/unconference-agenda-creation/">Unconference agenda creation</a>'));
  assert.ok(!/<h2>Blog posts<\/h2>[\s\S]*\/unconference\/basics\//.test(html), "chapters are not listed as blog posts");
});

test("the archive combines cross-posts and keeps different posts apart", async () => {
  const { groupPosts } = await import("../lib/archive.js");
  const p = (platform, id, date, text, extra = {}) => ({ platform, id, url: `https://${platform}.example/${id}`, date, text, reply: null, images: [], link: null, quote: null, ...extra });
  const items = groupPosts([
    p("bluesky", "b1", "2026-01-01T10:00:00Z", "Cracking day with @imhuyorks.bsky.social in #Leeds today"),
    p("mastodon", "m1", "2026-01-01T10:03:00Z", "Cracking day with Imran Hussain in #Leeds today, so much done"),
    p("mastodon", "m2", "2026-01-01T10:05:00Z", "Something completely different about trains and timetables"),
    p("bluesky", "b2", "2026-01-01T12:00:00Z", "Cracking day with @imhuyorks.bsky.social in #Leeds today"),
  ]);
  assert.equal(items.length, 3);
  const leeds = items.find((i) => i.on.length === 2);
  assert.deepEqual(leeds.on.map((o) => o.platform), ["bluesky", "mastodon"]);
  assert.match(leeds.text, /so much done/, "uses the longest version");
});

test("the archive never includes private Mastodon posts", () => {
  const posts = JSON.parse(fs.readFileSync("archive-data/mastodon.json", "utf8"));
  const source = fs.readFileSync("scripts/archive/fetch-mastodon.js", "utf8");
  assert.match(source, /visibility !== "public" && s\.visibility !== "unlisted"/);
  assert.ok(posts.length > 0);
});

test("the archive finds YouTube videos but not channels or playlists", async () => {
  const { youtubeVideos } = await import("../lib/archive.js");
  const v = youtubeVideos(
    "Watch https://youtube.com/shorts/4s3zwIW8IXs and https://youtu.be/hHxgruAozjo?si=abc",
    "Also https://www.youtube.com/watch?v=gm0b_ijaYMQ&t=10 and again https://youtu.be/hHxgruAozjo",
    "My channel https://youtube.com/@jacattell and https://youtube.com/playlist?list=PL123"
  );
  assert.deepEqual(v, [
    { id: "4s3zwIW8IXs", short: true },
    { id: "hHxgruAozjo", short: false },
    { id: "gm0b_ijaYMQ", short: false },
  ]);
});

test("the chat can read the social media archive, and caches it", () => {
  const context = fs.readFileSync("_site/chat-context.txt", "utf8");
  assert.match(context, /SOCIAL MEDIA ARCHIVE \(https:\/\/www\.cattell\.com\/archive\/\)/);
  const items = JSON.parse(fs.readFileSync("_site/archive/posts.json", "utf8"));
  assert.ok(context.includes(items[0].on[0].url), "includes the newest post");
  assert.ok(context.includes(items.at(-1).on[0].url), "includes the oldest post");
  const system = buildSystem(context);
  assert.equal(system.length, 1);
  assert.deepEqual(system[0].cache_control, { type: "ephemeral" });
  assert.ok(system[0].text.includes("<website>") && system[0].text.includes("SOCIAL MEDIA ARCHIVE"));
});
