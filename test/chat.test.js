import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
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
  const forChat = items.filter((i) => !i.reply && i.on.some((o) => o.platform !== "x"));
  assert.ok(context.includes(forChat[0].on[0].url), "includes the newest post");
  assert.ok(context.includes(forChat.at(-1).on[0].url), "includes the oldest post");
  const xOnly = items.filter((i) => i.on.every((o) => o.platform === "x"));
  assert.ok(xOnly.length > 1000 && !xOnly.slice(0, 50).some((i) => context.includes(i.on[0].url)), "posts only on X are left out");
  // Keep the chat's input under 100,000 tokens (about 4 characters each), where the price per token goes up.
  assert.ok(buildSystem(context)[0].text.length < 360_000, `chat context is ${context.length} characters`);
  const system = buildSystem(context);
  assert.equal(system.length, 1);
  assert.deepEqual(system[0].cache_control, { type: "ephemeral" });
  assert.ok(system[0].text.includes("<website>") && system[0].text.includes("SOCIAL MEDIA ARCHIVE"));
});

test("the archive shows every different image from a cross-post, once", async () => {
  const { mergeImages } = await import("../lib/archive.js");
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
  const { groupPosts } = await import("../lib/archive.js");
  const post = { platform: "bluesky", id: "1", url: "https://bsky.app/x", date: "2026-01-01T10:00:00Z", text: "Photo", reply: null, link: null, quote: null,
    images: [{ url: "https://cdn.bsky.app/img/feed_fullsize/plain/a/b", alt: "Saved" }, { url: "https://cdn.bsky.app/img/feed_fullsize/plain/a/c", alt: "Not saved" }] };
  const media = { "https://cdn.bsky.app/img/feed_fullsize/plain/a/b": { file: "/assets/archive/b.webp", thumb: "/assets/archive/b-thumb.webp" } };
  const [item] = groupPosts([post], media);
  assert.equal(item.images[0].url, "/assets/archive/b.webp");
  assert.equal(item.images[0].thumb, "/assets/archive/b-thumb.webp");
  assert.equal(item.images[1].thumb, "https://cdn.bsky.app/img/feed_thumbnail/plain/a/c", "falls back to the platform");
});

test("every image and YouTube thumbnail the archive shows has a saved copy", () => {
  const items = JSON.parse(fs.readFileSync("_site/archive/posts.json", "utf8"));
  const remote = [...items.flatMap((i) => i.images), ...items.flatMap((i) => i.videos)].filter((m) => m.thumb && !m.thumb.startsWith("/assets/archive/"));
  assert.deepEqual(remote.map((m) => m.thumb), []);
  for (const v of items.flatMap((i) => i.videos)) assert.ok(fs.existsSync("_site" + v.thumb), v.thumb);
  for (const m of items.flatMap((i) => i.images).filter((m) => m.thumb)) {
    assert.ok(fs.existsSync("_site" + m.thumb) && fs.existsSync("_site" + m.url), m.url);
  }
});

test("the forms check answers and email them through Resend", async () => {
  const { handleForm } = await import("../lib/forms.js");
  const env = { RESEND_API_KEY: "test-key", FORM_TO: "james@example.com" };
  const sent = [];
  const fakeResend = async (url, init) => { sent.push({ url, init: { ...init, body: JSON.parse(init.body) } }); return new Response("{}", { status: 200 }); };
  const post = (fields, ip = "1.1.1.1") => new Request("https://www.cattell.com/api/form", { method: "POST", body: new URLSearchParams(fields), headers: { "CF-Connecting-IP": ip } });

  let res = await handleForm(post({ form: "contact", message: "Hello James", email: "sam@example.org" }), env, fakeResend);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("Location"), "/contact/thanks/");
  assert.equal(sent[0].url, "https://api.resend.com/emails");
  assert.equal(sent[0].init.headers.Authorization, "Bearer test-key");
  assert.deepEqual(sent[0].init.body.to, ["james@example.com"]);
  assert.equal(sent[0].init.body.reply_to, "sam@example.org");
  assert.equal(sent[0].init.body.from, "cattell.com forms <forms@updates.cattell.com>", "sends from the domain verified in Resend");
  assert.match(sent[0].init.body.text, /Hello James/);

  res = await handleForm(post({ form: "feedback", where: "Other", where_other: "DeliverCon", feedback: "Keep running unconferences" }, "2.2.2.2"), env, fakeResend);
  assert.equal(res.headers.get("Location"), "/feedback/thanks/");
  assert.match(sent[1].init.body.text, /DeliverCon[\s\S]*Keep running unconferences[\s\S]*\(anonymous\)/);

  // Problems: missing answers, a bad email address, "somewhere else" left blank
  assert.equal((await handleForm(post({ form: "contact", message: "", email: "a@b.co" }, "3.3.3.3"), env, fakeResend)).status, 400);
  assert.equal((await handleForm(post({ form: "contact", message: "Hi", email: "not-an-email" }, "3.3.3.3"), env, fakeResend)).status, 400);
  assert.equal((await handleForm(post({ form: "feedback", where: "Other", feedback: "Hi" }, "3.3.3.3"), env, fakeResend)).status, 400);
  // Spam trap: pretends to work, sends nothing
  res = await handleForm(post({ form: "contact", message: "Buy now", email: "spam@example.com", website: "http://spam" }, "4.4.4.4"), env, fakeResend);
  assert.equal(res.status, 303);
  assert.equal(sent.length, 2);
  // Resend failing shows a problem page
  const res500 = await handleForm(post({ form: "contact", message: "Hi", email: "a@b.co" }, "5.5.5.5"), env, async () => new Response("down", { status: 500 }));
  assert.equal(res500.status, 400);
  assert.match(await res500.text(), /could not be sent/);
  // Resend can't be reached at all: still a problem page, not a crash
  const resDown = await handleForm(post({ form: "contact", message: "Hi", email: "a@b.co" }, "7.7.7.7"), env, async () => { throw new Error("network down"); });
  assert.equal(resDown.status, 400);
  // Not set up yet
  assert.match(await (await handleForm(post({ form: "contact", message: "Hi", email: "a@b.co" }, "6.6.6.6"), {}, fakeResend)).text(), /not working yet/);
});

test("the feedback form lists the places the site accepts", async () => {
  const { WORKED_ON } = await import("../lib/forms.js");
  const html = fs.readFileSync("_site/feedback/index.html", "utf8");
  const shown = [...html.matchAll(/name="where" value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(shown, [...WORKED_ON, "Other"]);
  assert.deepEqual(WORKED_ON, ["UKGovCamp", "OneTeamGov"]);
});

test("the hidden GOV.UK version has a copy of every page (except the editor), kept out of search engines", () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : e.name === "index.html" ? [`${d}/`] : []));
  const main = walk("_site").filter((p) => !p.startsWith("_site/govuk/") && !p.startsWith("_site/edit/")).map((p) => p.slice(5)).sort();
  const govuk = walk("_site/govuk").map((p) => p.slice(11)).sort();
  assert.deepEqual(govuk, main);
  const html = fs.readFileSync("_site/govuk/week-notes/2026/14/index.html", "utf8");
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /class="govuk-heading-xl">Week 14, 2026</);
  // No GOV.UK brand assets: the pages don't use GOV.UK's header, crown or logo, and the styles load no GDS Transport font.
  assert.ok(!/govuk-header|govuk-footer__crown|govuk-logo|<svg[^>]*crown/i.test(html), "no GOV.UK header, crown or logo on the page");
  const css = fs.readFileSync("_site/govuk/assets/govuk.css", "utf8");
  assert.ok(!/GDS Transport|@font-face/.test(css), "no GOV.UK font");
  assert.match(fs.readFileSync("_site/_headers", "utf8"), /\/govuk\/\*\s+X-Robots-Tag: noindex, nofollow/);
  assert.ok(!fs.readFileSync("_site/index.html", "utf8").includes("/govuk/"), "the main site does not link to it");
});

test("the How-to page has moved to Hidden stuff, and its old addresses redirect", () => {
  const html = fs.readFileSync("_site/hidden/index.html", "utf8");
  assert.match(html, /<h1>Hidden stuff<\/h1>/);
  for (const link of ["/hidden/bitwarden-desktop-upgrade/", "/govuk/", "https://multi-post.cattell.com/", "/archive/"]) assert.ok(html.includes(`href="${link}"`), link);
  assert.ok(!html.includes("multi-boot"));
  assert.ok(fs.existsSync("_site/hidden/bitwarden-desktop-upgrade/index.html"));
  const rules = fs.readFileSync("_site/_redirects", "utf8");
  assert.match(rules, /^\/how-to\/ \/hidden\/ 301$/m);
  assert.match(rules, /^\/how-to\/bitwarden-desktop-upgrade \/hidden\/bitwarden-desktop-upgrade\/ 301$/m);
  assert.match(fs.readFileSync("_site/index.html", "utf8"), /href="\/hidden\/">π/);
});

test("each page's Source on GitHub link goes to that page's own file", () => {
  const link = (file) => fs.readFileSync(file, "utf8").match(/href="([^"]+)">Source on GitHub/)[1];
  const base = "https://github.com/jacattell/cattell.com/blob/main/";
  assert.equal(link("_site/week-notes/2026/14/index.html"), base + "src/week-notes/2026/14.md");
  assert.equal(link("_site/index.html"), base + "src/index.md");
  assert.equal(link("_site/archive/2024/index.html"), base + "src/archive/year.njk");
  assert.equal(link("_site/govuk/week-notes/2026/14/index.html"), base + "src/week-notes/2026/14.md", "GOV.UK copies link to the page they copy");
  // Every link points at a file that exists in the repo
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : e.name.endsWith(".html") ? [`${d}/${e.name}`] : []));
  for (const file of walk("_site")) {
    const m = fs.readFileSync(file, "utf8").match(/href="https:\/\/github\.com\/jacattell\/cattell\.com\/blob\/main\/([^"]+)">Source on GitHub/);
    if (m) assert.ok(fs.existsSync(m[1]), `${file}: ${m[1]}`);
  }
});

test("week notes editor: notes are read and written in the same format", async () => {
  const { parseNote, buildNote, utf8ToBase64, base64ToUtf8 } = await import("../lib/editor.js");
  const file = fs.readFileSync("src/week-notes/2026/14.md", "utf8");
  const note = parseNote(file);
  assert.equal(note.summary, "The Pensions Regulator");
  assert.equal(buildNote(note), file, "reading and saving an unchanged note changes nothing");
  assert.equal(buildNote({ summary: 'Say "hi"', body: "Text\n" }), '---\nsummary: "Say \\"hi\\""\n---\n\nText\n');
  assert.equal(base64ToUtf8(utf8ToBase64("Café ✅ 💚")), "Café ✅ 💚");
});

test("week notes editor: sign-in only lets allowed GitHub accounts in", async () => {
  const { handleLogin, handleCallback, handleEdit } = await import("../lib/editor.js");
  const env = { GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret", SESSION_SECRET: "x".repeat(40) };
  // Not set up: says so
  assert.equal((await handleLogin(new Request("https://www.cattell.com/api/auth/login"), {})).headers.get("Location"), "/edit/?problem=setup");
  // Sign in: goes to GitHub with a state that must come back
  const login = await handleLogin(new Request("https://www.cattell.com/api/auth/login"), env);
  const to = new URL(login.headers.get("Location"));
  assert.equal(to.origin + to.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(to.searchParams.get("redirect_uri"), "https://www.cattell.com/api/auth/callback");
  const state = to.searchParams.get("state");
  assert.match(login.headers.get("Set-Cookie"), new RegExp(`edit_state=${state};.*HttpOnly; Secure; SameSite=Lax`));

  const fakeGitHub = (user) => async (url) =>
    url.includes("access_token") ? new Response(JSON.stringify({ access_token: "gho_test" })) : new Response(JSON.stringify({ login: user }));
  const back = (s, cookieState = state) => new Request(`https://www.cattell.com/api/auth/callback?code=abc&state=${s}`, { headers: { Cookie: `edit_state=${cookieState}` } });
  // Wrong state: refused
  assert.equal((await handleCallback(back("forged"), env, fakeGitHub("jacattell"))).headers.get("Location"), "/edit/?problem=signin");
  // Someone else's account: refused
  assert.equal((await handleCallback(back(state), env, fakeGitHub("someone-else"))).headers.get("Location"), "/edit/?problem=notallowed");
  // James: signed in with an encrypted session cookie
  const ok = await handleCallback(back(state), env, fakeGitHub("jacattell"));
  assert.equal(ok.headers.get("Location"), "/edit/");
  const session = ok.headers.getSetCookie().find((c) => c.startsWith("edit_session="));
  assert.match(session, /HttpOnly; Secure; SameSite=Strict/);
  assert.ok(!session.includes("gho_test"), "the GitHub token is not readable in the cookie");

  const value = session.split(";")[0];
  const me = await handleEdit(new Request("https://www.cattell.com/api/edit/me", { headers: { Cookie: value } }), env);
  assert.deepEqual(await me.json(), { login: "jacattell" });
  // A tampered cookie is not accepted
  const bad = await handleEdit(new Request("https://www.cattell.com/api/edit/me", { headers: { Cookie: value.slice(0, -4) + "AAAA" } }), env);
  assert.equal(bad.status, 401);
});

test("week notes editor: lists, opens and saves notes in the repo", async () => {
  const { handleCallback, handleEdit, utf8ToBase64, base64ToUtf8 } = await import("../lib/editor.js");
  const env = { GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret", SESSION_SECRET: "y".repeat(40) };
  const calls = [];
  const github = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes("access_token")) return new Response(JSON.stringify({ access_token: "gho_test" }));
    if (url.endsWith("/user")) return new Response(JSON.stringify({ login: "jacattell" }));
    if (url.includes("/git/trees/")) return new Response(JSON.stringify({ tree: [{ path: "src/week-notes/2025/49.md" }, { path: "src/week-notes/2026/07.md" }, { path: "src/index.md" }] }));
    if (url.includes("/contents/") && (!init.method || init.method === "GET")) return new Response(JSON.stringify({ sha: "abc", content: utf8ToBase64('---\nsummary: "Old"\n---\n\nHello\n') }));
    if (url.includes("/contents/") && init.method === "PUT") return new Response(JSON.stringify({ content: { sha: "def" }, commit: { html_url: "https://github.com/c/1" } }));
    return new Response("{}", { status: 404 });
  };
  const signin = await handleCallback(new Request("https://www.cattell.com/api/auth/callback?code=a&state=s", { headers: { Cookie: "edit_state=s" } }), env, github);
  const Cookie = signin.headers.getSetCookie().find((c) => c.startsWith("edit_session=")).split(";")[0];
  const req = (path, init = {}) => new Request(`https://www.cattell.com/api/edit/${path}`, { ...init, headers: { Cookie, "X-Editor": "1", ...(init.headers || {}) } });

  const list = await (await handleEdit(req("notes"), env, github)).json();
  assert.deepEqual(list.notes.map((n) => n.path), ["2026/07", "2025/49"]);
  const note = await (await handleEdit(req("note?path=2026/07"), env, github)).json();
  assert.equal(note.summary, "Old");
  assert.equal(note.body, "Hello\n");

  const res = await handleEdit(req("note", { method: "PUT", body: JSON.stringify({ path: "2026/07", summary: "New", body: "Hello again", sha: "abc" }) }), env, github);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).url, "/week-notes/2026/07/");
  const put = calls.find((c) => c.init.method === "PUT");
  assert.ok(put.url.endsWith("/repos/jacattell/cattell.com/contents/src/week-notes/2026/07.md"));
  const sent = JSON.parse(put.init.body);
  assert.equal(base64ToUtf8(sent.content), '---\nsummary: "New"\n---\n\nHello again\n');
  assert.equal(sent.sha, "abc");
  assert.equal(sent.branch, "main");
  assert.equal(sent.message, "Update week note: week 7, 2026");

  // Only week note files can be changed
  assert.equal((await handleEdit(req("note", { method: "PUT", body: JSON.stringify({ path: "../../eleventy.config", body: "x" }) }), env, github)).status, 400);
  assert.equal((await handleEdit(req("note?path=../index"), env, github)).status, 400);
  // Changes need the editor's own header
  const noHeader = new Request("https://www.cattell.com/api/edit/note", { method: "PUT", headers: { Cookie }, body: JSON.stringify({ path: "2026/07", body: "x" }) });
  assert.equal((await handleEdit(noHeader, env, github)).status, 403);
  // Not signed in
  assert.equal((await handleEdit(new Request("https://www.cattell.com/api/edit/notes"), env, github)).status, 401);
  // Preview
  assert.match((await (await handleEdit(req("preview", { method: "POST", body: JSON.stringify({ body: "## Hi" }) }), env, github)).json()).html, /<h2>Hi<\/h2>/);
});

test("the editor page is hidden from search engines and the GOV.UK copy", () => {
  const html = fs.readFileSync("_site/edit/index.html", "utf8");
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.ok(!fs.existsSync("_site/govuk/edit/index.html"));
  assert.match(fs.readFileSync("_site/_headers", "utf8"), /\/edit\/\*\s+X-Robots-Tag: noindex, nofollow/);
});

test("Hidden stuff links to the editor, in both versions of the site", () => {
  assert.match(fs.readFileSync("_site/hidden/index.html", "utf8"), /<a href="\/edit\/">Edit Week notes<\/a>/);
  assert.match(fs.readFileSync("_site/govuk/hidden/index.html", "utf8"), /href="\/edit\/">Edit Week notes<\/a>/, "the GOV.UK version links to the real editor");
});

test("the forms check visitors are human, once Turnstile is set up", async () => {
  const { handleForm } = await import("../lib/forms.js");
  const env = { RESEND_API_KEY: "test-key", FORM_TO: "james@example.com", TURNSTILE_SITE_KEY: "0x-site", TURNSTILE_SECRET_KEY: "turnstile-secret" };
  const sent = [];
  const net = (human) => async (url, init) => {
    if (url.startsWith("https://challenges.cloudflare.com/")) {
      sent.push({ check: Object.fromEntries(new URLSearchParams(init.body)) });
      return new Response(JSON.stringify({ success: human }));
    }
    sent.push({ email: JSON.parse(init.body) });
    return new Response("{}");
  };
  const post = (fields, ip) => new Request("https://www.cattell.com/api/form", { method: "POST", body: new URLSearchParams({ form: "contact", message: "Hello", email: "sam@example.org", ...fields }), headers: { "CF-Connecting-IP": ip } });

  // No check done: refused, nothing sent
  let res = await handleForm(post({}, "10.0.0.1"), env, net(true));
  assert.equal(res.status, 400);
  assert.match(await res.text(), /are you human/);
  // Check failed: refused, nothing emailed
  res = await handleForm(post({ "cf-turnstile-response": "bad" }, "10.0.0.2"), env, net(false));
  assert.equal(res.status, 400);
  assert.ok(!sent.some((s) => s.email));
  // Check passed: emailed, and Cloudflare was asked with the secret, token and visitor address
  res = await handleForm(post({ "cf-turnstile-response": "good" }, "10.0.0.3"), env, net(true));
  assert.equal(res.headers.get("Location"), "/contact/thanks/");
  assert.deepEqual(sent.at(-2).check, { secret: "turnstile-secret", response: "good", remoteip: "10.0.0.3" });
  assert.ok(sent.at(-1).email);
  // Cloudflare can't be reached: refused rather than let through
  res = await handleForm(post({ "cf-turnstile-response": "good" }, "10.0.0.4"), env, async (url) => { if (url.includes("challenges")) throw new Error("down"); return new Response("{}"); });
  assert.equal(res.status, 400);
});

test("the human check is only used when both keys are set, so the page and server agree", async () => {
  const { handleForm, handleFormConfig } = await import("../lib/forms.js");
  const key = async (env) => (await handleFormConfig(env).json()).turnstileSiteKey;
  assert.equal(await key({}), null);
  assert.equal(await key({ TURNSTILE_SECRET_KEY: "s" }), null, "secret alone: no check shown");
  assert.equal(await key({ TURNSTILE_SITE_KEY: "0x-site" }), null, "site key alone: no check shown");
  assert.equal(await key({ TURNSTILE_SITE_KEY: "0x-site", TURNSTILE_SECRET_KEY: "s" }), "0x-site");
  // With only the secret set, forms still send (the check is off), rather than refusing everything.
  const res = await handleForm(new Request("https://www.cattell.com/api/form", { method: "POST", body: new URLSearchParams({ form: "contact", message: "Hi", email: "a@b.co" }), headers: { "CF-Connecting-IP": "10.9.9.9" } }),
    { RESEND_API_KEY: "k", FORM_TO: "j@example.com", TURNSTILE_SECRET_KEY: "s" }, async () => new Response("{}"));
  assert.equal(res.headers.get("Location"), "/contact/thanks/");
  // Both forms load the check's script
  for (const page of ["_site/contact/index.html", "_site/feedback/index.html"]) {
    const html = fs.readFileSync(page, "utf8");
    assert.match(html, /<div class="human-check" data-human-check hidden><\/div>/, page);
    assert.match(html, /\/assets\/js\/human-check\.js\?v=/, page);
  }
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

test("chat logs: conversations are saved for 30 days, without IP addresses", async () => {
  const { logConversation, conversationStart, LOG_DAYS } = await import("../lib/chat.js");
  const now = Date.parse("2026-11-12T12:00:00Z");
  const id = (t) => String(1e13 - t).padStart(13, "0") + "-abcd1234";
  assert.equal(conversationStart(id(now - 60e3), now), now - 60e3);
  assert.equal(conversationStart(id(now - 5 * 86400e3), now), null, "too old to be real");
  assert.equal(conversationStart("not-an-id", now), null);

  const kv = fakeKV();
  const messages = [{ role: "user", content: "Who is James?" }, { role: "assistant", content: "A delivery manager." }, { role: "user", content: "What's DeliverCon?" }];
  assert.equal(await logConversation(kv, id(now - 60e3), messages, "An unconference for delivery managers.", now), true);
  const [[key, { value, opts }]] = kv.store;
  assert.equal(key, `conv:${id(now - 60e3)}`);
  assert.equal(opts.expirationTtl, LOG_DAYS * 86400);
  assert.equal(LOG_DAYS, 30);
  assert.deepEqual(JSON.parse(value).turns, [
    { q: "Who is James?", a: "A delivery manager." },
    { q: "What's DeliverCon?", a: "An unconference for delivery managers." },
  ]);
  assert.deepEqual(opts.metadata, { started: "2026-11-12T11:59:00.000Z", updated: "2026-11-12T12:00:00.000Z", turns: 2, first: "Who is James?" });
  assert.ok(!/\b\d{1,3}(\.\d{1,3}){3}\b/.test(value), "no IP addresses");
  assert.equal(await logConversation(kv, "made-up", messages, "x", now), false, "unknown IDs are not saved");
});

test("chat logs: only the signed-in editor can read them, newest first", async () => {
  const { handleCallback, handleEdit } = await import("../lib/editor.js");
  const { logConversation } = await import("../lib/chat.js");
  const kv = fakeKV();
  const now = Date.now();
  const id = (ago) => String(1e13 - (now - ago)).padStart(13, "0") + "-abcd1234";
  await logConversation(kv, id(3600e3), [{ role: "user", content: "Older question" }], "Answer 1", now);
  await logConversation(kv, id(60e3), [{ role: "user", content: "Newer question" }], "Answer 2", now);
  const env = { GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret", SESSION_SECRET: "z".repeat(40), CHAT_LOGS: kv };
  const github = async (url) => new Response(JSON.stringify(url.includes("access_token") ? { access_token: "t" } : { login: "jacattell" }));
  const signin = await handleCallback(new Request("https://www.cattell.com/api/auth/callback?code=a&state=s", { headers: { Cookie: "edit_state=s" } }), env, github);
  const Cookie = signin.headers.getSetCookie().find((c) => c.startsWith("edit_session=")).split(";")[0];

  assert.equal((await handleEdit(new Request("https://www.cattell.com/api/edit/chats"), env)).status, 401, "not signed in");
  const list = await (await handleEdit(new Request("https://www.cattell.com/api/edit/chats", { headers: { Cookie } }), env)).json();
  assert.deepEqual(list.chats.map((c) => c.first), ["Newer question", "Older question"]);
  const one = await (await handleEdit(new Request(`https://www.cattell.com/api/edit/chat?id=${id(60e3)}`, { headers: { Cookie } }), env)).json();
  assert.deepEqual(one.turns, [{ q: "Newer question", a: "Answer 2" }]);
  assert.equal((await handleEdit(new Request("https://www.cattell.com/api/edit/chat?id=../x", { headers: { Cookie } }), env)).status, 400);
  // Not set up yet
  assert.equal((await handleEdit(new Request("https://www.cattell.com/api/edit/chats", { headers: { Cookie } }), { ...env, CHAT_LOGS: undefined })).status, 503);
});

test("the Chat page tells visitors conversations are kept for 30 days", () => {
  const html = fs.readFileSync("_site/chat/index.html", "utf8");
  assert.match(html, /Conversations are kept for 30 days/);
  assert.match(fs.readFileSync("_site/edit/chats/index.html", "utf8"), /<meta name="robots" content="noindex, nofollow">/);
});

test("chat logs: a finished chat reply is saved to the log", async () => {
  const { handleChat } = await import("../lib/chat.js");
  const sse = (events) => events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  const reply = sse([
    ["message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "James runs " } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "unconferences." } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 4 } }],
    ["message_stop", { type: "message_stop" }],
  ]);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => String(url).startsWith("https://api.anthropic.com") ? new Response(reply, { headers: { "Content-Type": "text/event-stream" } }) : realFetch(url);
  try {
    const kv = fakeKV();
    const conversation = String(1e13 - Date.now()).padStart(13, "0") + "-abcd1234";
    const req = new Request("https://www.cattell.com/api/chat", { method: "POST", headers: { "CF-Connecting-IP": "10.1.1.1" }, body: JSON.stringify({ conversation, messages: [{ role: "user", content: "What does James do?" }] }) });
    const result = await handleChat(req, { ANTHROPIC_API_KEY: "sk-test", CHAT_LOGS: kv });
    const streamed = await new Response(result.response.body).text();
    await result.done;
    assert.match(streamed, /James runs /);
    assert.deepEqual((await kv.get(`conv:${conversation}`, "json")).turns, [{ q: "What does James do?", a: "James runs unconferences." }]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("chat logs: the list still shows dates and questions when a summary is missing", async () => {
  const { handleCallback, handleEdit } = await import("../lib/editor.js");
  const kv = fakeKV();
  const started = Date.now() - 600e3;
  const id = String(1e13 - started).padStart(13, "0") + "-abcd1234";
  // Saved without the summary that normally goes with the key
  await kv.put(`conv:${id}`, JSON.stringify({ started: new Date(started).toISOString(), turns: [{ q: "Hello?", a: "Hi." }, { q: "Bye", a: "Bye." }] }));
  const env = { GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret", SESSION_SECRET: "w".repeat(40), CHAT_LOGS: kv };
  const github = async (url) => new Response(JSON.stringify(url.includes("access_token") ? { access_token: "t" } : { login: "jacattell" }));
  const signin = await handleCallback(new Request("https://www.cattell.com/api/auth/callback?code=a&state=s", { headers: { Cookie: "edit_state=s" } }), env, github);
  const Cookie = signin.headers.getSetCookie().find((c) => c.startsWith("edit_session=")).split(";")[0];
  const { chats: [chat] } = await (await handleEdit(new Request("https://www.cattell.com/api/edit/chats", { headers: { Cookie } }), env)).json();
  assert.equal(chat.started, new Date(started).toISOString());
  assert.equal(chat.turns, 2);
  assert.equal(chat.first, "Hello?");
  // Nothing at all to go on: the start time still comes from the ID
  kv.store.set(`conv:${id}`, { value: "{}", opts: {} });
  const { chats: [bare] } = await (await handleEdit(new Request("https://www.cattell.com/api/edit/chats", { headers: { Cookie } }), env)).json();
  assert.equal(bare.started, new Date(started).toISOString());
  assert.equal(bare.turns, 0);
});

test("Hidden stuff links to the chat logs, in both versions of the site", () => {
  assert.match(fs.readFileSync("_site/hidden/index.html", "utf8"), /<a href="\/edit\/chats\/">Chat logs<\/a>/);
  assert.match(fs.readFileSync("_site/govuk/hidden/index.html", "utf8"), /href="\/edit\/chats\/">Chat logs<\/a>/);
});

test("week notes editor: saved settings can't break out of the front matter", async () => {
  const { handleCallback, handleEdit, safeFrontMatterLine } = await import("../lib/editor.js");
  assert.ok(safeFrontMatterLine("layout: layouts/note.njk"));
  assert.ok(safeFrontMatterLine("  - indented: yaml"));
  for (const bad of ["a: b\npermalink: /index.html", "---", " --- ", "x\r", 5]) assert.ok(!safeFrontMatterLine(bad), JSON.stringify(bad));

  const env = { GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret", SESSION_SECRET: "z".repeat(40) };
  const puts = [];
  const github = async (url, init = {}) => {
    if (url.includes("access_token")) return new Response(JSON.stringify({ access_token: "gho_test" }));
    if (url.endsWith("/user")) return new Response(JSON.stringify({ login: "jacattell" }));
    if (init.method === "PUT") { puts.push(init); return new Response(JSON.stringify({ content: { sha: "new" } })); }
    return new Response("{}", { status: 404 });
  };
  const login = new Request("https://www.cattell.com/api/auth/callback?code=c&state=s", { headers: { Cookie: "edit_state=s" } });
  const cookie = (await handleCallback(login, env, github)).headers.getSetCookie().find((c) => c.startsWith("edit_session=")).split(";")[0];
  const save = (other) => handleEdit(new Request("https://www.cattell.com/api/edit/note", {
    method: "PUT", headers: { Cookie: cookie, "X-Editor": "1" }, body: JSON.stringify({ path: "2026/20", body: "Hi\n", other }),
  }), env, github);
  assert.equal((await save(["title: x\n---\npermalink: /index.html"])).status, 400);
  assert.equal((await save(["---"])).status, 400);
  assert.equal((await save("layout: x")).status, 400);
  assert.equal(puts.length, 0, "nothing was saved");
});

test("week notes editor: sign-out only from this site, and cancels the GitHub key", async () => {
  const { handleCallback, handleLogout } = await import("../lib/editor.js");
  const env = { GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret", SESSION_SECRET: "w".repeat(40) };
  const calls = [];
  const github = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes("access_token")) return new Response(JSON.stringify({ access_token: "gho_test" }));
    if (url.endsWith("/user")) return new Response(JSON.stringify({ login: "jacattell" }));
    return new Response(null, { status: 204 });
  };
  const login = new Request("https://www.cattell.com/api/auth/callback?code=c&state=s", { headers: { Cookie: "edit_state=s" } });
  const cookie = (await handleCallback(login, env, github)).headers.getSetCookie().find((c) => c.startsWith("edit_session=")).split(";")[0];
  const out = (origin) => handleLogout(new Request("https://www.cattell.com/api/auth/logout", { method: "POST", headers: { Cookie: cookie, ...(origin ? { Origin: origin } : {}) } }), env, github);

  const fetchSite = await handleLogout(new Request("https://www.cattell.com/api/auth/logout", { method: "POST", headers: { Cookie: cookie, "Sec-Fetch-Site": "cross-site" } }), env, github);
  assert.ok(!fetchSite.headers.getSetCookie().length, "cross-site without Origin: still signed in");
  for (const origin of ["https://evil.example", null]) {
    const res = await out(origin);
    assert.ok(!res.headers.getSetCookie().length, `${origin}: still signed in`);
  }
  assert.equal(calls.filter((c) => c.init.method === "DELETE").length, 0);

  const res = await out("https://www.cattell.com");
  assert.match(res.headers.getSetCookie()[0], /^edit_session=;.*Max-Age=0/);
  const cancel = calls.find((c) => c.init.method === "DELETE");
  assert.equal(cancel.url, "https://api.github.com/applications/id/token");
  assert.equal(cancel.init.headers.Authorization, `Basic ${btoa("id:secret")}`);
  assert.deepEqual(JSON.parse(cancel.init.body), { access_token: "gho_test" });
  // No Origin (some privacy tools remove it), but the browser says it's from this site
  const noOrigin = await handleLogout(new Request("https://www.cattell.com/api/auth/logout", { method: "POST", headers: { Cookie: cookie, "Sec-Fetch-Site": "same-origin" } }), env, github);
  assert.match(noOrigin.headers.getSetCookie()[0], /^edit_session=;.*Max-Age=0/);
});

test("security headers: no framing, and the editor's policy allows its inline script", () => {
  const headers = fs.readFileSync("_site/_headers", "utf8");
  assert.match(headers, /^\/\*\n(?:  .*\n)*  X-Frame-Options: DENY\n/m);
  const policy = headers.match(/^\/edit\/\*\n(?:  .*\n)*?  Content-Security-Policy: (.*)$/m)[1];
  const inline = fs.readFileSync("_site/edit/index.html", "utf8").match(/<script>([\s\S]*?)<\/script>/)[1];
  const hash = crypto.createHash("sha256").update(inline).digest("base64");
  assert.ok(policy.includes(`script-src 'self' 'sha256-${hash}'`), policy);
  assert.ok(!/unsafe-inline|unsafe-eval/.test(policy));
});

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
  const { groupPosts } = await import("../lib/archive.js");
  const [item] = groupPosts([{ platform: "x", id: "1", url: "https://x.com/jaCattell/status/1", date: "2012-01-01T00:00:00Z", text: "Hi", reply: null, images: [{ url: "https://pbs.twimg.com/media/gone.jpg", alt: "" }], link: null, quote: null }], { "https://pbs.twimg.com/media/gone.jpg": { unavailable: true } });
  assert.deepEqual([item.images[0].url, item.images[0].thumb, item.images[0].alt], [null, null, "no longer available"]);

  const page1 = fs.readFileSync("_site/archive/2012/index.html", "utf8");
  assert.equal((page1.match(/<article class="post">/g) || []).length, 200);
  assert.match(page1, /<a class="next" href="\/archive\/2012\/page-2\/" rel="next"><span>Older posts<\/span>/);
  const page2 = fs.readFileSync("_site/archive/2012/page-2/index.html", "utf8");
  assert.match(page2, /<a href="\/archive\/2012\/" rel="prev"><span>Newer posts<\/span>/);
  assert.ok(fs.existsSync("_site/govuk/archive/2012/page-2/index.html"));
});

test("the archive shows a cross-post's images once when one copy is from X", async () => {
  const { mergeImages } = await import("../lib/archive.js");
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

test("week notes editor: session key comes from HKDF, and old-style cookies are refused", async () => {
  const { sealSession, openSession } = await import("../lib/editor.js");
  const secret = "s".repeat(40);
  const sealed = await sealSession({ token: "gho_x", login: "jacattell" }, secret);
  assert.equal((await openSession(sealed, secret)).login, "jacattell");
  assert.equal(await openSession(sealed, "t".repeat(40)), null, "a different secret can't open it");

  // A cookie made the old way (key = SHA-256 of the secret) no longer opens.
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const oldKey = await crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new TextEncoder().encode(JSON.stringify({ token: "gho_x", login: "jacattell", exp: Date.now() + 3600e3 }));
  const bytes = new Uint8Array([...iv, ...new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, oldKey, body))]);
  const old = Buffer.from(bytes).toString("base64url");
  assert.equal(await openSession(old, secret), null);
});

test("security policy: every page's inline scripts are allowed, and nothing else inline", () => {
  const headers = fs.readFileSync("_site/_headers", "utf8");
  const policy = headers.match(/^\/\*\n(?:  .*\n)*?  Content-Security-Policy: (.*)$/m)[1];
  const directive = (name) => policy.split(";").map((d) => d.trim()).find((d) => d.startsWith(name + " "));
  assert.equal(directive("default-src"), "default-src 'self'");
  assert.equal(directive("style-src"), "style-src 'self'");
  assert.equal(directive("frame-ancestors"), "frame-ancestors 'none'");
  assert.ok(!/unsafe-inline|unsafe-eval/.test(policy));
  const scripts = directive("script-src");
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
  const seen = new Set();
  for (const file of walk("_site").filter((f) => f.endsWith(".html"))) {
    const html = fs.readFileSync(file, "utf8");
    assert.ok(!/ style="|<style|\son[a-z]+="/i.test(html.replace(/<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>/g, "")), `${file}: inline style or event attribute`);
    for (const m of html.matchAll(/<script(?: type="module")?>([\s\S]*?)<\/script>/g)) {
      const hash = `'sha256-${crypto.createHash("sha256").update(m[1]).digest("base64")}'`;
      if (!seen.has(hash)) assert.ok(scripts.includes(hash), `${file}: inline script not allowed by the policy`);
      seen.add(hash);
    }
    for (const m of html.matchAll(/<iframe[^>]*src="([^"]+)"/g)) assert.ok(m[1].startsWith("https://www.youtube-nocookie.com/"), `${file}: frame from ${m[1]} is blocked by the policy`);
  }
  assert.ok(seen.size >= 3, "the light/dark and GOV.UK scripts were checked");
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
  new Request("https://www.cattell.com/api/sessions", { method: "POST", headers: key ? { Authorization: `Bearer ${key}` } : {}, body: JSON.stringify(body) });
const aSession = {
  source: "code", id: "f6e5815a-23ef-5fd4-a5b8-ec54ad0ef319", title: "Week note", project: "cattell.com",
  started: "2026-11-14T19:24:00Z", updated: "2026-11-14T20:17:00Z",
  messages: [
    { kind: "prompt", at: "2026-11-14T19:24:00Z", text: "Please build me a week note" },
    { kind: "answer", at: "2026-11-14T19:30:00Z", text: "Here is the draft. Started swimming again." },
  ],
};
/** Signs in as the editor and returns a function that calls /api/edit/* with the cookie. */
async function editorFor(env) {
  const { sealSession, handleEdit } = await import("../lib/editor.js");
  const Cookie = `edit_session=${await sealSession({ token: "t", login: "jacattell" }, env.SESSION_SECRET)}`;
  return (path, init = {}) => handleEdit(new Request(`https://www.cattell.com/api/edit/${path}`, { ...init, headers: { Cookie, ...(init.method ? { "X-Editor": "1" } : {}) } }), env);
}
const archiveEnv = async () => ({ SESSIONS: await fakeD1(), ARCHIVE_KEY, GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret", SESSION_SECRET: "s".repeat(40) });

test("sessions archive: uploads need the archive key, and a set-up database", async () => {
  const { handleUpload } = await import("../lib/sessions.js");
  const env = await archiveEnv();
  assert.equal((await handleUpload(sendSession(aSession, null), env)).status, 401, "no key");
  assert.equal((await handleUpload(sendSession(aSession, "x".repeat(40)), env)).status, 401, "wrong key");
  assert.equal((await handleUpload(sendSession(aSession), { ...env, SESSIONS: undefined })).status, 503, "no database");
  assert.equal((await handleUpload(sendSession(aSession), { ...env, ARCHIVE_KEY: "short" })).status, 503, "a short key is not accepted");
  assert.equal((await handleUpload(new Request("https://www.cattell.com/api/sessions"), env)).status, 405);
  assert.equal((await handleUpload(sendSession({ ...aSession, source: "other" }), env)).status, 400);
  assert.equal((await handleUpload(sendSession({ ...aSession, id: "../x" }), env)).status, 400);
  assert.equal((await handleUpload(sendSession({ ...aSession, messages: [{ kind: "system", text: "x" }] }), env)).status, 400);
  assert.equal((await handleUpload(sendSession(aSession), env)).status, 200);
  assert.equal(env.SESSIONS.sqlite.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 1, "only the good upload was saved");
});

test("sessions archive: only the signed-in editor can list, search and read sessions", async () => {
  const { handleUpload } = await import("../lib/sessions.js");
  const { handleEdit } = await import("../lib/editor.js");
  const env = await archiveEnv();
  await handleUpload(sendSession(aSession), env);
  await handleUpload(sendSession({ ...aSession, source: "chat", id: "93a0d0f5-e0d0-4181-a321-c2e9d53de95f", title: "Sewing box badge", project: "", updated: "2026-11-14T18:31:00Z", messages: [{ kind: "prompt", at: "2026-11-14T18:00:00Z", text: "What is this badge?" }] }), env);

  for (const path of ["sessions", "sessions?q=badge", "session?id=code:" + aSession.id]) {
    assert.equal((await handleEdit(new Request(`https://www.cattell.com/api/edit/${path}`), env)).status, 401, `${path} when not signed in`);
  }
  const edit = await editorFor(env);
  const list = await (await edit("sessions")).json();
  assert.deepEqual(list.sessions.map((s) => s.title), ["Week note", "Sewing box badge"], "newest first");
  assert.deepEqual(list.total, { sessions: 2, messages: 3 });
  assert.equal(list.sessions[0].public, false, "sessions are private");
  assert.deepEqual((await (await edit("sessions?source=chat")).json()).sessions.map((s) => s.source), ["chat"]);

  const found = await (await edit("sessions?q=swim")).json();
  assert.equal(found.results.length, 1, "the start of a word is enough");
  assert.equal(found.results[0].id, "code:" + aSession.id);
  assert.equal(found.results[0].n, 1);
  assert.match(found.results[0].snippet, /\u0001swimming\u0002 again/);
  assert.equal((await (await edit("sessions?q=swimming+badge")).json()).results.length, 0, "every word must be in the message");
  assert.equal((await (await edit("sessions?q=badge&source=code")).json()).results.length, 0);
  assert.equal((await edit(`sessions?q=${encodeURIComponent('"badge" OR NOT (')}`)).status, 200, "punctuation can't break the search");

  const one = await (await edit("session?id=code:" + aSession.id)).json();
  assert.equal(one.session.title, "Week note");
  assert.deepEqual(one.messages.map((m) => [m.n, m.kind]), [[0, "prompt"], [1, "answer"]]);
  assert.equal((await edit("session?id=code:../x")).status, 400);
  assert.equal((await edit("session?id=code:00000000-0000")).status, 404);
  assert.equal((await edit("sessions", {})).status, 200);
  assert.equal((await handleEdit(new Request("https://www.cattell.com/api/edit/sessions", { headers: { Cookie: "edit_session=nope" } }), env)).status, 401);
});

test("sessions archive: sending a session again replaces it, and long ones arrive in parts", async () => {
  const { handleUpload } = await import("../lib/sessions.js");
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
  assert.equal((await handleUpload(new Request("https://www.cattell.com/api/sessions", { method: "POST", headers: { Authorization: `Bearer ${ARCHIVE_KEY}` }, body: "x".repeat(900_001) }), env)).status, 413);
});

test("sessions archive: a session can be deleted, only from the archive page", async () => {
  const { handleUpload } = await import("../lib/sessions.js");
  const { handleEdit, sealSession } = await import("../lib/editor.js");
  const env = await archiveEnv();
  const edit = await editorFor(env);
  await handleUpload(sendSession(aSession), env);
  const Cookie = `edit_session=${await sealSession({ token: "t", login: "jacattell" }, env.SESSION_SECRET)}`;
  const fromElsewhere = new Request(`https://www.cattell.com/api/edit/session?id=code:${aSession.id}`, { method: "DELETE", headers: { Cookie } });
  assert.equal((await handleEdit(fromElsewhere, env)).status, 403);
  assert.equal((await edit(`session?id=code:${aSession.id}`, { method: "DELETE" })).status, 200);
  assert.equal((await (await edit("sessions")).json()).sessions.length, 0);
  assert.equal((await (await edit("sessions?q=swimming")).json()).results.length, 0, "deleted from the search too");
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
  const { handleUpload } = await import("../lib/sessions.js");
  const env = await archiveEnv();
  const send = (url, init) => handleUpload(new Request(url, init), env);
  assert.equal(await upload(aSession, { url: "https://www.cattell.com", key: ARCHIVE_KEY }, send), 2);
  await assert.rejects(upload(aSession, { url: "https://www.cattell.com", key: "wrong".repeat(8) }, send), /archive key is missing or wrong/);
});

test("the sessions archive page is hidden, linked from Hidden stuff, and its hook only runs the upload script", () => {
  const html = fs.readFileSync("_site/edit/sessions/index.html", "utf8");
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /\/assets\/js\/sessions\.js\?v=/);
  assert.ok(!fs.existsSync("_site/govuk/edit/sessions/index.html"));
  assert.match(fs.readFileSync("_site/hidden/index.html", "utf8"), /<a href="\/edit\/sessions\/">Claude sessions archive<\/a>/);
  assert.ok(!fs.readFileSync("_site/chat-context.txt", "utf8").includes("/edit/sessions/"), "the public chat page isn't told about it");
  const hooks = JSON.parse(fs.readFileSync(".claude/settings.json", "utf8")).hooks;
  assert.deepEqual(Object.keys(hooks), ["Stop", "SessionEnd"]);
  for (const event of ["Stop", "SessionEnd"]) assert.match(hooks[event][0].hooks[0].command, /^node "\$\{CLAUDE_PROJECT_DIR\}\/scripts\/sessions\/upload-claude-code\.js" --hook$/);
  assert.equal(hooks.Stop[0].hooks[0].async, true, "sending after each reply doesn't hold Claude up");
  const other = JSON.parse(fs.readFileSync("scripts/sessions/for-other-repos/settings.json", "utf8")).hooks;
  assert.deepEqual(Object.keys(other), ["Stop", "SessionEnd"]);
});

test("sessions archive: thinking, tool calls and results are saved, searchable, and sent in full only on request", async () => {
  const { handleUpload } = await import("../lib/sessions.js");
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
  assert.equal(archiveUrl(undefined), "https://www.cattell.com");
  assert.equal(archiveUrl("https://www.cattell.com/"), "https://www.cattell.com");
  assert.equal(archiveUrl("http://localhost:8788"), "http://localhost:8788");
  assert.equal(archiveUrl("http://127.0.0.1:8788/"), "http://127.0.0.1:8788");
  for (const bad of ["http://www.cattell.com", "http://attacker.example", "ftp://www.cattell.com", "file:///tmp/x", "www.cattell.com", "http://localhost.attacker.example"]) assert.throws(() => archiveUrl(bad), /ARCHIVE_URL/);
});

test("the editor's preview only keeps web, email and page links, however a javascript: link is disguised", () => {
  const source = fs.readFileSync("src/assets/js/edit.js", "utf8");
  const safeUrl = new Function(`return ${/const safeUrl = (.+);\n/.exec(source)[1]}`)();
  const ok = (v) => safeUrl(v, "https://www.cattell.com/edit/");
  for (const good of ["https://example.com/", "http://example.com/", "mailto:james@example.com", "/week-notes/2026/46/", "#top", "../contact/", "page.html", "//example.com/x"]) assert.ok(ok(good), good);
  for (const bad of ["javascript:alert(1)", " javascript:alert(1)", "JaVaScRiPt:alert(1)", "java\tscript:alert(1)", "java\nscript:alert(1)", "\u0001javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x", "blob:https://www.cattell.com/x", "file:///etc/passwd"]) assert.ok(!ok(bad), JSON.stringify(bad));
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

test("the API only answers on the site's own address, not Cloudflare's pages.dev ones", async () => {
  const { refuseOtherAddress } = await import("../lib/address.js");
  for (const ok of ["https://www.cattell.com/api/chat", "http://localhost:8788/api/chat", "http://127.0.0.1:8788/api/form", "https://notpages.dev/api/chat"]) {
    assert.equal(refuseOtherAddress(new Request(ok)), null, ok);
  }
  for (const no of ["https://cattell-com.pages.dev/api/chat", "https://some-branch.cattell-com.pages.dev/api/sessions", "https://CATTELL-COM.PAGES.DEV/api/edit/me"]) {
    const res = refuseOtherAddress(new Request(no, { method: "POST" }));
    assert.equal(res.status, 404, no);
    assert.match((await res.json()).error, /www\.cattell\.com/);
  }
  // The check runs before every API function, and those addresses are kept out of search engines.
  const middleware = fs.readFileSync("functions/api/_middleware.js", "utf8");
  assert.match(middleware, /refuseOtherAddress\(context\.request\) \?\? context\.next\(\)/);
  const headers = fs.readFileSync("_site/_headers", "utf8");
  assert.match(headers, /https:\/\/:project\.pages\.dev\/\*\n\s+X-Robots-Tag: noindex/);
  assert.match(headers, /https:\/\/:version\.:project\.pages\.dev\/\*\n\s+X-Robots-Tag: noindex/);
});

test("week notes editor: sign-in asks GitHub for no wider permission", async () => {
  const { handleLogin } = await import("../lib/editor.js");
  const res = await handleLogin(new Request("https://www.cattell.com/api/auth/login"), { GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret", SESSION_SECRET: "s".repeat(32) });
  const to = new URL(res.headers.get("Location"));
  assert.equal(to.origin + to.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(to.searchParams.get("scope"), null);
});
