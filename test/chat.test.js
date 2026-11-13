import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
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
  assert.ok(context.includes(items[0].on[0].url), "includes the newest post");
  assert.ok(context.includes(items.at(-1).on[0].url), "includes the oldest post");
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
});

test("security headers: no framing, and the editor's policy allows its inline script", () => {
  const headers = fs.readFileSync("_site/_headers", "utf8");
  assert.match(headers, /^\/\*\n(?:  .*\n)*  X-Frame-Options: DENY\n(?:  .*\n)*  Content-Security-Policy: frame-ancestors 'none'/m);
  const policy = headers.match(/^\/edit\/\*\n(?:  .*\n)*?  Content-Security-Policy: (.*)$/m)[1];
  const inline = fs.readFileSync("_site/edit/index.html", "utf8").match(/<script>([\s\S]*?)<\/script>/)[1];
  const hash = crypto.createHash("sha256").update(inline).digest("base64");
  assert.ok(policy.includes(`script-src 'self' 'sha256-${hash}'`), policy);
  assert.ok(!/unsafe-inline|unsafe-eval/.test(policy));
});
