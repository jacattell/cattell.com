import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";












test("the archive combines cross-posts and keeps different posts apart", async () => {
  const { groupPosts } = await import("../scripts/lib/archive.js");
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
  const { youtubeVideos } = await import("../scripts/lib/archive.js");
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


test("the archive shows every different image from a cross-post, once", async () => {
  const { mergeImages } = await import("../scripts/lib/archive.js");
  const post = (images) => ({ images });
  const img = (alt, url = alt) => ({ url, alt });
  // Different images on each platform: all are kept
  assert.equal(mergeImages([post([img("Blue skies and grass"), img("Selfie on the grass")]), post([img("James and Mary pose for a selfie with a book")])]).length, 3);
  // Same image, worded slightly differently: kept once
  assert.equal(mergeImages([post([img("Selfie of me with a lovely white horse")]), post([img("Selfie of me with a beautiful white horse")])]).length, 1);
  // No descriptions, same places in the post: kept once each
  assert.equal(mergeImages([post([img("", "b1"), img("", "b2")]), post([img("", "m1"), img("", "m2")])]).length, 2);
  // An image on one platform and the same thing as a video on the other: kept once
  assert.equal(mergeImages([post([img("People sit round a table in a meeting room")]), post([{ url: "v.mp4", alt: "People sit round a table in a meeting room", video: true }])]).length, 1);
  assert.equal(mergeImages([post([img("", "snow.jpg")]), post([{ url: "snow.mp4", alt: "", video: true }])]).length, 1);
  // The same video, described on only one platform: kept once, using the described copy
  const dalek = mergeImages([post([{ url: null, alt: "Video", video: true }]), post([{ url: "dalek.mp4", alt: "A dancing Dalek", video: true }])]);
  assert.deepEqual(dalek, [{ url: "dalek.mp4", alt: "A dancing Dalek", video: true }]);
  // One video each: kept once
  assert.equal(mergeImages([post([{ url: null, alt: "Video", video: true }]), post([{ url: "v.mp4", alt: "", video: true }])]).length, 1);
});

test("the archive uses its own copies of images where it has them", async () => {
  const { groupPosts } = await import("../scripts/lib/archive.js");
  const post = { platform: "bluesky", id: "1", url: "https://bsky.app/x", date: "2026-01-01T10:00:00Z", text: "Photo", reply: null, link: null, quote: null,
    images: [{ url: "https://cdn.bsky.app/img/feed_fullsize/plain/a/b", alt: "Saved" }, { url: "https://cdn.bsky.app/img/feed_fullsize/plain/a/c", alt: "Not saved" }] };
  const media = { "https://cdn.bsky.app/img/feed_fullsize/plain/a/b": { file: "/assets/archive/b.webp", thumb: "/assets/archive/b-thumb.webp" } };
  const [item] = groupPosts([post], media);
  assert.equal(item.images[0].url, "/assets/archive/b.webp");
  assert.equal(item.images[0].thumb, "/assets/archive/b-thumb.webp");
  assert.equal(item.images[1].thumb, "https://cdn.bsky.app/img/feed_thumbnail/plain/a/c", "falls back to the platform");
});














/** A pretend Cloudflare KV store that records expiry times. */
function fakeKV() {
  const store = new Map();
  return {
    store,
    async put(key, value, opts = {}) { store.set(key, { value, opts }); },
    async get(key, type) { const v = store.get(key)?.value; return v === undefined ? null : type === "json" ? JSON.parse(v) : v; },
    async list({ prefix, limit = 1000, cursor }) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const page = keys.slice(start, start + limit);
      return { keys: page.map((name) => ({ name, metadata: store.get(name).opts.metadata, expiration: 2000000000 })), list_complete: start + limit >= keys.length, cursor: String(start + limit) };
    },
  };
}










test("X archive import: own tweets and replies, without retweets, with real links", async () => {
  const { fromTweet } = await import("../scripts/archive/import-x.js");
  const base = { id_str: "1200000000000000000", created_at: "Sat Nov 30 12:00:00 +0000 2019", entities: { urls: [] } };
  assert.equal(fromTweet({ ...base, full_text: "RT @someone: their words" }), null, "retweets are left out");

  const post = fromTweet({
    ...base,
    full_text: "Q&amp;A at https://t.co/abc &lt;3 https://t.co/pic",
    entities: { urls: [{ url: "https://t.co/abc", expanded_url: "https://www.cattell.com/" }] },
    extended_entities: { media: [{ url: "https://t.co/pic", type: "photo", media_url_https: "https://pbs.twimg.com/media/X.jpg" }] },
  });
  assert.equal(post.text, "Q&A at https://www.cattell.com/ <3");
  assert.deepEqual(post.images, [{ url: "https://pbs.twimg.com/media/X.jpg", alt: "" }]);
  assert.equal(post.url, "https://x.com/jaCattell/status/1200000000000000000");
  assert.equal(post.date, new Date(Number(1200000000000000000n >> 22n) + 1288834974657).toISOString(), "the date comes from the tweet ID");

  const reply = fromTweet({ ...base, full_text: "@a @b Thanks!", in_reply_to_status_id_str: "5", in_reply_to_screen_name: "a", in_reply_to_user_id_str: "9" });
  assert.equal(reply.text, "Thanks!");
  assert.deepEqual(reply.reply, { url: "https://x.com/a/status/5", self: false });
  const thread = fromTweet({ ...base, full_text: "@jaCattell And another thing", in_reply_to_status_id_str: "5", in_reply_to_screen_name: "jaCattell", in_reply_to_user_id_str: "118012929" });
  assert.equal(thread.reply.self, true);

  const quote = fromTweet({ ...base, full_text: "So true https://t.co/q", entities: { urls: [{ url: "https://t.co/q", expanded_url: "https://twitter.com/other/status/42" }] } });
  assert.equal(quote.text, "So true");
  assert.equal(quote.quote, "https://twitter.com/other/status/42");

  // An old tweet whose date in the archive is wrong (1997): the date comes from its ID.
  const old = fromTweet({ id_str: "146331678426660865", created_at: "Tue Sep 02 22:03:52 +0000 1997", full_text: "Apps are 10p", entities: { urls: [] } });
  assert.equal(old.date.slice(0, 7), "2011-12");
});

test("the archive splits busy years into pages, and images X no longer has are marked", async () => {
  const { groupPosts } = await import("../scripts/lib/archive.js");
  const [item] = groupPosts([{ platform: "x", id: "1", url: "https://x.com/jaCattell/status/1", date: "2012-01-01T00:00:00Z", text: "Hi", reply: null, images: [{ url: "https://pbs.twimg.com/media/gone.jpg", alt: "" }], link: null, quote: null }], { "https://pbs.twimg.com/media/gone.jpg": { unavailable: true } });
  assert.deepEqual([item.images[0].url, item.images[0].thumb, item.images[0].alt], [null, null, "no longer available"]);

  const page1 = fs.readFileSync("public/archive/2012/index.html", "utf8");
  assert.equal((page1.match(/<article class="post">/g) || []).length, 200);
  assert.match(page1, /<a class="pager-newer" href="\/archive\/2012\/page-2\/" rel="next"><span class="pager-label">Older posts<\/span>/);
  const page2 = fs.readFileSync("public/archive/2012/page-2/index.html", "utf8");
  assert.match(page2, /<a class="pager-older" href="\/archive\/2012\/" rel="prev"><span class="pager-label">Newer posts<\/span>/);
});

test("the archive shows a cross-post's images once when one copy is from X", async () => {
  const { mergeImages } = await import("../scripts/lib/archive.js");
  const bsky = { platform: "bluesky", images: [{ url: "b1", alt: "A map of Manchester" }, { url: "b2", alt: "A venue" }] };
  const x = { platform: "x", images: [{ url: "x1", alt: "" }, { url: "x2", alt: "" }] };
  assert.deepEqual(mergeImages([x, bsky]).map((i) => i.url), ["b1", "b2"], "the described copies are kept");
  assert.deepEqual(mergeImages([bsky, x]).map((i) => i.url), ["b1", "b2"]);
  const more = { platform: "x", images: [...x.images, { url: "x3", alt: "" }] };
  assert.deepEqual(mergeImages([bsky, more]).map((i) => i.url), ["b1", "b2", "x3"], "an extra image on X is added");
});

test("LinkedIn import: reads the export's posts, line breaks and photos", async () => {
  const { parseCsv, cleanText, richMediaTime, fromExport, postAddress } = await import("../scripts/archive/import-linkedin.js");
  const shares = parseCsv('Date,ShareLink,ShareCommentary,SharedUrl,MediaUrl,Visibility\n2026-11-11 23:45:38,https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A123,"First line. ""\n""""\n""Say ""hi"", please","","",MEMBER_NETWORK\n2025-01-02 09:00:00,https://www.linkedin.com/feed/update/urn%3Ali%3AugcPost%3A456,"",https://example.com/,"",MEMBER_NETWORK\n');
  assert.equal(shares.length, 2);
  assert.equal(cleanText(shares[0].ShareCommentary), 'First line.\n\nSay "hi", please');
  assert.deepEqual(postAddress(shares[0].ShareLink), { urn: "urn:li:share:123", id: "123", url: "https://www.linkedin.com/feed/update/urn:li:share:123/" });
  assert.equal(richMediaTime("You uploaded a feed photo on November 6, 2026 at 9:05 PM (GMT)"), "2026-11-06T21:05");
  assert.equal(richMediaTime("You uploaded a feed photo on March 1, 2025 at 12:30 AM (GMT)"), "2025-03-01T00:30");

  const media = parseCsv([
    "Date/Time,Media Description,Media Link",
    '"You uploaded a feed photo on November 11, 2026 at 11:44 PM (GMT)",-,https://dms.licdn.com/photo1',
    '"You uploaded a profile photo on November 11, 2026 at 11:45 PM (GMT)",-,https://dms.licdn.com/me',
    '"You uploaded a feed photo on January 2, 2025 at 9:00 AM (GMT)",-,https://dms.licdn.com/photo2',
    '"You uploaded a video on January 2, 2025 at 9:00 AM (GMT)",-,https://dms.licdn.com/playlist/vid/abc',
  ].join("\n"));
  const [first, second] = fromExport(shares, media);
  assert.equal(first.date, "2026-11-11T23:45:38.000Z");
  assert.deepEqual(first.images, [{ url: "https://dms.licdn.com/photo1", alt: "" }], "profile photos are not post photos");
  assert.deepEqual(second.images, [{ url: "https://dms.licdn.com/photo2", alt: "" }, { url: null, alt: "Video", video: true }]);
  assert.deepEqual(second.link, { url: "https://example.com/", title: null });
});

test("LinkedIn import only keeps posts anyone can see", () => {
  const source = fs.readFileSync("scripts/archive/import-linkedin.js", "utf8");
  assert.match(source, /groupPost/);
  assert.match(source, /signup\|authwall\|login/);
  if (fs.existsSync("archive-data/linkedin.json")) {
    const posts = JSON.parse(fs.readFileSync("archive-data/linkedin.json", "utf8"));
    assert.ok(posts.every((p) => !p.url.includes("groupPost")), "no group posts");
  }
});




// ---------- Claude sessions archive ----------
/** A pretend Cloudflare D1 database, backed by a real SQLite database in memory. */
async function fakeD1() {
  const { DatabaseSync } = await import("node:sqlite");
  const sqlite = new DatabaseSync(":memory:");
  const db = {
    sqlite,
    prepare(sql) {
      const make = (args) => ({
        bind: (...next) => make(next),
        async all() { return { results: sqlite.prepare(sql).all(...args).map((r) => ({ ...r })) }; },
        async first() { const r = sqlite.prepare(sql).get(...args); return r ? { ...r } : null; },
        async run() { sqlite.prepare(sql).run(...args); return { success: true }; },
      });
      return make([]);
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try { for (const s of statements) await s.run(); sqlite.exec("COMMIT"); } catch (err) { sqlite.exec("ROLLBACK"); throw err; }
    },
  };
  return db;
}
const ARCHIVE_KEY = "k".repeat(40);
const sendSession = (body, key = ARCHIVE_KEY) =>
  new Request("https://admin.cattell.com/api/upload", { method: "POST", headers: key ? { Authorization: `Bearer ${key}` } : {}, body: JSON.stringify(body) });
const aSession = {
  source: "code", id: "f6e5815a-23ef-5fd4-a5b8-ec54ad0ef319", title: "Week note", project: "cattell.com",
  started: "2026-11-14T19:24:00Z", updated: "2026-11-14T20:17:00Z",
  messages: [
    { kind: "prompt", at: "2026-11-14T19:24:00Z", text: "Please build me a week note" },
    { kind: "answer", at: "2026-11-14T19:30:00Z", text: "Here is the draft. Started swimming again." },
  ],
};
const archiveEnv = async () => ({ SESSIONS: await fakeD1(), ARCHIVE_KEY });
/** Calls the admin Worker's sessions API directly (Cloudflare Access is tested in workers.test.js). */
async function editorFor(env) {
  const { handleSessions } = await import("../workers/admin/src/sessions.js");
  return (path, init = {}) => handleSessions(path.split("?")[0], new Request(`https://admin.cattell.com/api/${path}`, init), env);
}

test("sessions archive: uploads need the archive key, and a set-up database", async () => {
  const { handleUpload } = await import("../workers/admin/src/sessions.js");
  const env = await archiveEnv();
  assert.equal((await handleUpload(sendSession(aSession, null), env)).status, 401, "no key");
  assert.equal((await handleUpload(sendSession(aSession, "x".repeat(40)), env)).status, 401, "wrong key");
  assert.equal((await handleUpload(sendSession(aSession), { ...env, SESSIONS: undefined })).status, 503, "no database");
  assert.equal((await handleUpload(sendSession(aSession), { ...env, ARCHIVE_KEY: "short" })).status, 503, "a short key is not accepted");
  assert.equal((await handleUpload(new Request("https://admin.cattell.com/api/upload"), env)).status, 405);
  assert.equal((await handleUpload(sendSession({ ...aSession, source: "other" }), env)).status, 400);
  assert.equal((await handleUpload(sendSession({ ...aSession, id: "../x" }), env)).status, 400);
  assert.equal((await handleUpload(sendSession({ ...aSession, messages: [{ kind: "system", text: "x" }] }), env)).status, 400);
  assert.equal((await handleUpload(sendSession(aSession), env)).status, 200);
  assert.equal(env.SESSIONS.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 1, "only the good upload was saved");
});


test("sessions archive: sending a session again replaces it, and long ones arrive in parts", async () => {
  const { handleUpload } = await import("../workers/admin/src/sessions.js");
  const { uploadParts } = await import("../lib/session-formats.js");
  const env = await archiveEnv();
  const edit = await editorFor(env);
  await handleUpload(sendSession(aSession), env);
  env.SESSIONS.sqlite.prepare("UPDATE sessions SET public = 1").run();
  const longer = { ...aSession, title: "Week note 46", messages: [...aSession.messages, { kind: "prompt", text: "How do we set it up?" }] };
  assert.deepEqual(await (await handleUpload(sendSession(longer), env)).json(), { saved: "code:" + aSession.id, messages: 3 });
  const list = await (await edit("sessions")).json();
  assert.equal(list.sessions.length, 1);
  assert.equal(list.sessions[0].title, "Week note 46");
  assert.equal(list.sessions[0].messages, 3);
  assert.equal(list.sessions[0].public, true, "sending again does not change who can see a session");
  assert.equal((await (await edit("sessions?q=draft")).json()).results.length, 1, "the search has one copy, not two");

  const big = { ...aSession, id: "big-session-0001", messages: Array.from({ length: 30 }, (_, i) => ({ kind: i % 2 ? "answer" : "prompt", text: `message ${i} ` + "x".repeat(50_000) })) };
  const parts = uploadParts(big);
  assert.ok(parts.length > 1 && parts.every((p) => JSON.stringify(p).length < 900_000));
  assert.deepEqual(parts.map((p) => p.offset), parts.map((_, i) => parts.slice(0, i).reduce((n, p) => n + p.messages.length, 0)));
  for (const part of parts) assert.equal((await handleUpload(sendSession(part), env)).status, 200);
  const read = await (await edit("session?id=code:big-session-0001")).json();
  assert.equal(read.session.messages, 30);
  assert.deepEqual(read.messages.map((m) => m.n), Array.from({ length: 30 }, (_, i) => i));
  assert.equal((await handleUpload(new Request("https://admin.cattell.com/api/upload", { method: "POST", headers: { Authorization: `Bearer ${ARCHIVE_KEY}` }, body: "x".repeat(900_001) }), env)).status, 413);
});


test("sessions archive: reads Claude Code transcripts, with thinking, tool calls and tool results", async () => {
  const { parseClaudeCode } = await import("../lib/session-formats.js");
  const lines = [
    { type: "mode", mode: "default", sessionId: "abc12345-0000" },
    { type: "user", sessionId: "abc12345-0000", cwd: "/home/james/cattell.com", timestamp: "2026-11-14T19:24:00.000Z", message: { role: "user", content: [{ type: "text", text: "<system-reminder>\nhidden note\n</system-reminder>" }, { type: "text", text: "Build me a week note" }] } },
    { type: "assistant", timestamp: "2026-11-14T19:24:05.000Z", message: { role: "assistant", content: [{ type: "thinking", thinking: "Read the notes first.", signature: "sig" }, { type: "thinking", thinking: "", signature: "sig" }, { type: "text", text: "I'll read your notes." }, { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls notes" } }] } },
    { type: "user", timestamp: "2026-11-14T19:24:06.000Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "46.md" }] } },
    { type: "assistant", timestamp: "2026-11-14T19:25:00.000Z", message: { role: "assistant", content: [{ type: "text", text: "Here is the draft." }] } },
    { type: "assistant", timestamp: "2026-11-14T19:25:01.000Z", message: { role: "assistant", content: [{ type: "text", text: "It is 337 words." }] } },
    { type: "assistant", isSidechain: true, timestamp: "2026-11-14T19:25:30.000Z", message: { role: "assistant", content: [{ type: "text", text: "A subagent talking." }] } },
    { type: "user", timestamp: "2026-11-14T20:10:00.000Z", message: { role: "user", content: "How do we set it up?" } },
    { type: "custom-title", customTitle: "Week 46" },
  ];
  const s = parseClaudeCode(lines.map((l) => JSON.stringify(l)).join("\n") + "\nnot json\n");
  assert.deepEqual(s.messages, [
    { kind: "prompt", at: "2026-11-14T19:24:00.000Z", text: "Build me a week note" },
    { kind: "thinking", at: "2026-11-14T19:24:05.000Z", text: "Read the notes first." },
    { kind: "answer", at: "2026-11-14T19:24:05.000Z", text: "I'll read your notes." },
    { kind: "tool", tool: "Bash", at: "2026-11-14T19:24:05.000Z", text: '{\n  "command": "ls notes"\n}' },
    { kind: "result", tool: "Bash", at: "2026-11-14T19:24:06.000Z", text: "46.md" },
    { kind: "answer", at: "2026-11-14T19:25:00.000Z", text: "Here is the draft.\n\nIt is 337 words." },
    { kind: "prompt", at: "2026-11-14T20:10:00.000Z", text: "How do we set it up?" },
  ]);
  assert.deepEqual([s.source, s.id, s.title, s.project, s.started, s.updated], ["code", "abc12345-0000", "Week 46", "cattell.com", "2026-11-14T19:24:00.000Z", "2026-11-14T20:10:00.000Z"]);
  assert.ok(!JSON.stringify(s).includes("hidden note") && !JSON.stringify(s).includes("subagent") && !JSON.stringify(s).includes("sig"));
  const long = parseClaudeCode(JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "x", content: [{ type: "text", text: "y".repeat(300_000) }, { type: "image" }] }] } }));
  assert.equal(long.messages[0].text.length <= 200_000 && long.messages[0].text.endsWith("[The rest was too long to save.]"), true, "very long results are cut short, with a note");
  const untitled = parseClaudeCode(JSON.stringify(lines[1]), "from-the-file-name");
  assert.deepEqual([untitled.id, untitled.title], ["abc12345-0000", "Build me a week note"]);
  assert.equal(parseClaudeCode("", "from-the-file-name").id, "from-the-file-name");
});

test("sessions archive: reads chats from a claude.ai data export", async () => {
  const { parseClaudeExport } = await import("../lib/session-formats.js");
  const chats = parseClaudeExport([
    { uuid: "93a0d0f5-e0d0-4181-a321-c2e9d53de95f", name: "Mother's sewing box find", created_at: "2026-11-14T18:00:00Z", updated_at: "2026-11-14T18:31:00Z", chat_messages: [
      { sender: "human", text: "What is this?", content: [{ type: "text", text: "What is this?" }], created_at: "2026-11-14T18:00:00Z" },
      { sender: "assistant", text: "", content: [{ type: "tool_use", id: "w1", name: "web_search", input: { query: "badge" } }, { type: "tool_result", tool_use_id: "w1", content: [{ type: "text", text: "Sutton Hoo" }] }, { type: "text", text: "A pin badge." }], created_at: "2026-11-14T18:01:00Z" },
      { sender: "human", text: "Older exports only have this field", created_at: "2026-11-14T18:02:00Z" },
      { sender: "human", text: "", content: [{ type: "injected_prompt_block", prompt: "not typed by James" }, { type: "text", text: "Here is my CV" }], attachments: [{ file_name: "cv.txt", extracted_content: "James Cattell, delivery manager" }, { file_name: "photo.png" }], created_at: "2026-11-14T18:03:00Z" },
      { sender: "assistant", content: [
        { type: "thinking", thinking: "", hidden: true, summaries: [{ summary: "Reading the CV." }, { summary: "Checking dates." }] },
        { type: "thinking", thinking: "", hidden: true },
        { type: "tool_use", id: "w2", name: "web_fetch", input: { url: "https://www.cattell.com" } },
        { type: "tool_result", tool_use_id: "w2", content: [{ type: "knowledge", title: "cattell.com", url: "https://www.cattell.com", text: "Week notes" }, { type: "local_resource", file_path: "/mnt/out/cv.pdf" }, { type: "image", file_uuid: "x" }] },
      ], created_at: "2026-11-14T18:04:00Z" },
    ] },
    { uuid: "empty-chat-0001", name: "Empty", chat_messages: [] },
  ]);
  assert.equal(chats.length, 1, "empty chats are left out");
  assert.deepEqual([chats[0].source, chats[0].id, chats[0].title, chats[0].updated], ["chat", "93a0d0f5-e0d0-4181-a321-c2e9d53de95f", "Mother's sewing box find", "2026-11-14T18:31:00Z"]);
  assert.deepEqual(chats[0].messages.map((m) => [m.kind, m.tool || "", m.text]), [["prompt", "", "What is this?"], ["tool", "web_search", '{\n  "query": "badge"\n}'], ["result", "web_search", "Sutton Hoo"], ["answer", "", "A pin badge."], ["prompt", "", "Older exports only have this field"],
    ["prompt", "", "Here is my CV"], ["file", "cv.txt", "James Cattell, delivery manager"],
    ["thinking", "", "Reading the CV.\nChecking dates."],
    ["tool", "web_fetch", '{\n  "url": "https://www.cattell.com"\n}'],
    ["result", "web_fetch", "cattell.com\nhttps://www.cattell.com\nWeek notes\n\n[File: /mnt/out/cv.pdf]\n\n[image]"]]);
  assert.ok(!JSON.stringify(chats).includes("not typed by James"), "notes added by claude.ai are left out");
  const withKey = parseClaudeExport([{ uuid: "secret-file-0001", chat_messages: [{ sender: "human", content: [{ type: "text", text: "my settings" }], attachments: [{ file_name: ".env", extracted_content: "RESEND_API_KEY=re_abcdefgh_ABCDEFGHIJKLMNOPQRSTUV" }] }] }]);
  assert.equal(withKey[0].messages[1].text, "RESEND_API_KEY=[secret removed]", "secrets are removed from attached files too");
  assert.deepEqual(parseClaudeExport({ not: "a list" }), []);
});

test("sessions archive: the upload script sends the key, and reports a refusal", async () => {
  const { upload } = await import("../scripts/sessions/common.js");
  const { handleUpload } = await import("../workers/admin/src/sessions.js");
  const env = await archiveEnv();
  const send = (url, init) => handleUpload(new Request(url, init), env);
  assert.equal(await upload(aSession, { url: "https://www.cattell.com", key: ARCHIVE_KEY }, send), 2);
  await assert.rejects(upload(aSession, { url: "https://www.cattell.com", key: "wrong".repeat(8) }, send), /archive key is missing or wrong/);
});


test("sessions archive: thinking, tool calls and results are saved, searchable, and sent in full only on request", async () => {
  const { handleUpload } = await import("../workers/admin/src/sessions.js");
  const env = await archiveEnv();
  const edit = await editorFor(env);
  const id = "code:" + aSession.id;
  await handleUpload(sendSession({ ...aSession, messages: [
    aSession.messages[0],
    { kind: "thinking", text: "Read the existing notes first." },
    { kind: "tool", tool: "Bash", text: '{ "command": "cat 46.md" }' },
    { kind: "result", tool: "Bash", text: "glorious sunshine " + "z".repeat(5000) + " the very end" },
    aSession.messages[1],
  ] }), env);

  const list = await (await edit("sessions")).json();
  assert.equal(list.sessions[0].messages, 2, "the count is prompts and answers");
  assert.deepEqual(list.total, { sessions: 1, messages: 2 });

  const read = await (await edit("session?id=" + id)).json();
  assert.deepEqual(read.messages.map((m) => [m.kind, m.tool]), [["prompt", ""], ["thinking", ""], ["tool", "Bash"], ["result", "Bash"], ["answer", ""]]);
  assert.equal(read.messages[3].text.length, 2000, "only the start of a long result is sent with the session");
  assert.ok(read.messages[3].length > 5000);
  assert.equal(read.messages[4].text, aSession.messages[1].text, "answers are sent whole");
  const whole = await (await edit(`message?id=${id}&n=3`)).json();
  assert.match(whole.text, /the very end$/);
  assert.equal((await edit(`message?id=${id}&n=99`)).status, 404);
  assert.equal((await edit(`message?id=${id}&n=x`)).status, 400);

  const found = await (await edit("sessions?q=sunshine")).json();
  assert.deepEqual(found.results.map((r) => [r.kind, r.tool, r.n]), [["result", "Bash", 3]]);
  assert.equal((await (await edit("sessions?q=sunshine&only=talk")).json()).results.length, 0, "the search can leave out everything but prompts and answers");
  assert.equal((await (await edit("sessions?q=existing+notes")).json()).results[0].kind, "thinking");
  assert.equal((await (await edit("sessions?q=swimming&only=talk")).json()).results.length, 1);
  assert.equal((await handleUpload(sendSession({ ...aSession, messages: [{ kind: "file", tool: "cv.txt", text: "my CV" }] }), env)).status, 200, "attached files can be saved");
});

test("sessions archive: keys, tokens and passwords are removed before a session is sent", async () => {
  const { redact, parseClaudeCode, parseClaudeExport } = await import("../lib/session-formats.js");
  const gone = "[secret removed]";
  const secrets = {
    anthropic: "sk-ant-api03-" + "a1B2".repeat(12),
    github: "ghp_" + "x9".repeat(18),
    resend: "re_Ab12Cd34_" + "q7".repeat(12),
    aws: "AKIA" + "ABCD1234EFGH5678",
    jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123456789xyz",
    plain: "correct-horse-battery",
  };
  const env = `ANTHROPIC_API_KEY=${secrets.anthropic}\nARCHIVE_KEY="${secrets.plain}"\nexport DB_PASSWORD='${secrets.plain}'\nSITE_NAME=cattell.com`;
  assert.equal(redact(env), `ANTHROPIC_API_KEY=${gone}\nARCHIVE_KEY="${gone}"\nexport DB_PASSWORD='${gone}'\nSITE_NAME=cattell.com`);
  assert.equal(redact(`{"apiKey": "${secrets.plain}", "name": "James"}`), `{"apiKey": "${gone}", "name": "James"}`);
  assert.equal(redact(`curl -H "Authorization: Bearer ${secrets.plain}-1234" https://james:hunter2@example.com/x`), `curl -H "Authorization: Bearer ${gone}" https://james:${gone}@example.com/x`);
  for (const s of [secrets.anthropic, secrets.github, secrets.resend, secrets.aws, secrets.jwt]) assert.equal(redact(`found ${s} here`), `found ${gone} here`);
  assert.equal(redact("-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk=\nAAAA\n-----END OPENSSH PRIVATE KEY-----\nnext line"), `${gone}\nnext line`);
  assert.equal(redact(JSON.stringify({ key: "-----BEGIN PRIVATE KEY-----\nMIIEvQ==\n-----END PRIVATE KEY-----" })), `{"key":"${gone}"}`);

  // Ordinary text and code are left as they were.
  for (const same of [
    "Please build me a week note about the token ring network and my password manager.",
    'const ARCHIVE_KEY = "k".repeat(40);',
    "headers: { Authorization: `Bearer ${key}` }",
    "GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET, API_KEY=$API_KEY TOKEN=$(cat key)",
    "https://www.cattell.com:8443/week-notes/ and git@github.com:jacattell/cattell.com.git",
    "max_tokens: 2048, // short chat replies",
  ]) assert.equal(redact(same), same);
  assert.equal(redact(redact(env)), redact(env), "doing it twice changes nothing more");

  // Both readers do it, in every kind of message and in the title.
  const code = parseClaudeCode([
    { type: "user", message: { content: `My key is ${secrets.github}` } },
    { type: "assistant", message: { content: [{ type: "thinking", thinking: `The key ${secrets.github}` }, { type: "text", text: `Saved ${secrets.github}` }, { type: "tool_use", id: "t1", name: "Bash", input: { command: `export RESEND_API_KEY=${secrets.resend}` } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: env }] } },
    { type: "custom-title", customTitle: `Key ${secrets.github}` },
  ].map((l) => JSON.stringify(l)).join("\n"), "session-0001");
  const chat = parseClaudeExport([{ uuid: "chat-0000-0001", name: `Key ${secrets.github}`, chat_messages: [{ sender: "human", text: `My key is ${secrets.anthropic}` }] }]);
  assert.equal(code.messages.length, 5);
  for (const s of Object.values(secrets)) assert.ok(!JSON.stringify([code, chat]).includes(s), "no secret is left in what is sent");
  assert.equal(code.title, `Key ${gone}`);
});

test("sessions archive: the upload scripts only send the key to an https address", async () => {
  const { archiveUrl } = await import("../scripts/sessions/common.js");
  assert.equal(archiveUrl(undefined), "https://admin.cattell.com");
  assert.equal(archiveUrl("https://www.cattell.com/"), "https://www.cattell.com");
  assert.equal(archiveUrl("http://localhost:8788"), "http://localhost:8788");
  assert.equal(archiveUrl("http://127.0.0.1:8788/"), "http://127.0.0.1:8788");
  for (const bad of ["http://www.cattell.com", "http://attacker.example", "ftp://www.cattell.com", "file:///tmp/x", "www.cattell.com", "http://localhost.attacker.example"]) assert.throws(() => archiveUrl(bad), /ARCHIVE_URL/);
});


// ---------- the upload hook, run as Claude Code runs it ----------
/** Runs the upload script with --hook against a pretend archive, and returns what it received. */
async function runUploadHook({ env, transcript, event = "SessionEnd", home }) {
  const http = await import("node:http");
  const { spawn } = await import("node:child_process");
  const received = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const part = JSON.parse(body);
      received.push({ auth: req.headers.authorization || null, offset: part.offset, count: part.messages.length });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ saved: part.id, messages: part.offset + part.messages.length }));
    });
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const file = path.join(home, "session.jsonl");
  fs.writeFileSync(file, transcript);
  const child = spawn(process.execPath, ["scripts/sessions/upload-claude-code.js", "--hook"], {
    env: { PATH: process.env.PATH, HOME: home, ARCHIVE_URL: `http://127.0.0.1:${server.address().port}`, ...env },
  });
  child.stdin.end(JSON.stringify({ hook_event_name: event, transcript_path: file }));
  const output = [];
  child.stdout.on("data", (d) => output.push(String(d)));
  child.stderr.on("data", (d) => output.push(String(d)));
  const code = await new Promise((done) => child.on("close", done));
  server.close();
  return { received, code, output: output.join("") };
}
const transcriptOf = (n) => Array.from({ length: n }, (_, i) =>
  JSON.stringify({ type: i % 2 ? "assistant" : "user", sessionId: "hook-test-0001", timestamp: `2026-11-15T14:0${i % 10}:00Z`, message: { content: [{ type: "text", text: `message ${i}` }] } })).join("\n");

test("sessions archive: the hook only sends from James's own cloud environments, without holding the key", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hook-"));
  const cloud = { CLAUDE_CODE_REMOTE: "true" };
  let r = await runUploadHook({ env: cloud, transcript: transcriptOf(4), home });
  assert.equal(r.received.length, 0, "someone else's cloud session sends nothing");
  assert.equal(r.code, 0);
  assert.equal(r.output, "", "the hook never prints anything");
  r = await runUploadHook({ env: { ...cloud, CATTELL_ARCHIVE: "1" }, transcript: transcriptOf(4), home });
  assert.deepEqual(r.received, [{ auth: null, offset: 0, count: 4 }], "the network secret adds the key outside the session");
  r = await runUploadHook({ env: {}, transcript: transcriptOf(4), home: fs.mkdtempSync(path.join(os.tmpdir(), "hook-")) });
  assert.equal(r.received.length, 0, "on a computer without the key, nothing is sent");
  // Behind a proxy, as in a cloud session: the script restarts itself so that fetch uses the proxy.
  r = await runUploadHook({ env: { ...cloud, CATTELL_ARCHIVE: "1", HTTPS_PROXY: "http://127.0.0.1:9", NO_PROXY: "127.0.0.1" }, transcript: transcriptOf(5), home });
  assert.deepEqual(r.received, [{ auth: null, offset: 3, count: 2 }], "it still sends from behind a proxy");
  assert.equal(r.output, "", "and still prints nothing, not even Node's warning");
});

test("sessions archive: the hook sends only what is new since last time", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hook-"));
  const env = { ARCHIVE_KEY: ARCHIVE_KEY };
  let r = await runUploadHook({ env, transcript: transcriptOf(3), home });
  assert.deepEqual(r.received, [{ auth: `Bearer ${ARCHIVE_KEY}`, offset: 0, count: 3 }]);
  r = await runUploadHook({ env, transcript: transcriptOf(6), home });
  assert.deepEqual(r.received, [{ auth: `Bearer ${ARCHIVE_KEY}`, offset: 2, count: 4 }], "the last message sent before is sent again, in case the answer grew");
  r = await runUploadHook({ env, transcript: transcriptOf(6), home, event: "Stop" });
  assert.deepEqual(r.received, [{ auth: `Bearer ${ARCHIVE_KEY}`, offset: 5, count: 1 }]);
  fs.mkdirSync(path.join(home, ".cache", "cattell-archive", "sending.lock"));
  r = await runUploadHook({ env, transcript: transcriptOf(8), home });
  assert.equal(r.received.length, 0, "a second copy waits for the one already sending");
});



test("chat and forms stop reading a request that is too big", async () => {
  const { readBytes, readText, readForm } = await import("../workers/shared/body.js");
  // A body that never ends: reading must stop at the limit, not run out of memory.
  let sent = 0;
  let cancelled = false;
  const endless = () => new ReadableStream({
    pull(c) { sent += 16_384; c.enqueue(new Uint8Array(16_384).fill(97)); },
    cancel() { cancelled = true; },
  });
  const post = (body, headers = {}) => new Request("https://www.cattell.com/api/chat", { method: "POST", headers, body, duplex: "half" });
  assert.equal(await readBytes(post(endless()), 64 * 1024), null);
  assert.ok(sent <= 64 * 1024 + 5 * 16_384, `stopped early (read ${sent} bytes)`);
  assert.ok(cancelled, "the rest of the upload is abandoned");
  // A request that says up front it is too big isn't read at all.
  const declared = post(endless(), { "Content-Length": "999999" });
  assert.equal(await readText(declared, 1000), null);
  assert.equal(declared.bodyUsed, false);
  // Ordinary requests read as before, including non-English text.
  assert.equal(await readText(post("héllo ✓"), 100), "héllo ✓");
  assert.equal(await readText(post("x".repeat(100)), 100), "x".repeat(100));
  assert.equal(await readText(post("x".repeat(101)), 100), null);
  assert.equal(await readText(new Request("https://www.cattell.com/api/chat", { method: "POST" }), 100), "");
  const form = await readForm(post(new URLSearchParams({ form: "contact", message: "héllo ✓" })), 1000);
  assert.deepEqual(Object.fromEntries(form), { form: "contact", message: "héllo ✓" });
  const multi = new FormData();
  multi.set("message", "from a multipart form");
  assert.equal((await readForm(post(multi), 2000)).get("message"), "from a multipart form");

  // The chat and the forms use it.
  const { handleChat } = await import("../workers/public/src/chat.js");
  const big = await handleChat(post(endless(), { "CF-Connecting-IP": "198.51.100.77" }), { ANTHROPIC_API_KEY: "k" });
  assert.equal(big.response.status, 413);
  const { handleForm } = await import("../workers/public/src/forms.js");
  const bigForm = await handleForm(post(endless(), { "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "198.51.100.78" }), {});
  assert.match(await bigForm.text(), /too long to send/);
});



