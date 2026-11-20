// Tests for the two Cloudflare Workers (workers/public and workers/admin). No packages.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

import publicWorker, { fromSite } from "../workers/public/src/index.js";
import { handleForm, validateForm } from "../workers/public/src/forms.js";
import adminWorker, { handle as adminHandle, sameSite, PAGE_CSP } from "../workers/admin/src/index.js";
import { verifyAccess, resetKeyCache } from "../workers/admin/src/access.js";
import { pkcs1ToPkcs8, appJwt, importPrivateKey, resetTokenCache } from "../workers/admin/src/github.js";
import { parseNote, buildNote, safeFrontMatterLine, isoWeekStart, handleNotes, base64ToUtf8 } from "../workers/admin/src/notes.js";
import { renderMarkdown, safeUrl } from "../workers/admin/src/markdown.js";

// ---------- fakes ----------
const ctx = () => { const waits = []; return { waits, waitUntil: (p) => waits.push(p) }; };
const SITE = "https://www.cattell.com";
const ip = () => `198.51.100.${Math.floor(Math.random() * 250) + 1}`;

test("public API: only the website may use it, only on api.cattell.com, with security headers", async () => {
  const call = (url, init = {}) => publicWorker.fetch(new Request(url, init), {}, ctx());
  assert.equal((await call("https://cattell-public.example.workers.dev/form", { method: "POST" })).status, 404);
  const noOrigin = await call("https://api.cattell.com/form", { method: "POST", body: "a=b" });
  assert.equal(noOrigin.status, 403);
  const other = await call("https://api.cattell.com/form", { method: "POST", headers: { Origin: "https://evil.example" }, body: "a=b" });
  assert.equal(other.status, 403);
  const gone = await call("https://api.cattell.com/chat", { method: "POST", headers: { Origin: SITE }, body: "{}" });
  assert.equal(gone.status, 404, "the old Ask my AI address is gone");
  for (const r of [noOrigin, other, gone]) {
    assert.equal(r.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(r.headers.get("X-Frame-Options"), "DENY");
    assert.match(r.headers.get("Content-Security-Policy"), /default-src 'none'/);
  }
  assert.equal((await call("https://api.cattell.com/form")).status, 405);
  assert.equal(fromSite(new Request(SITE, { headers: { Origin: "https://www.cattell.com.evil.example" } }), {}), false);
  const config = fs.readFileSync("workers/public/wrangler.jsonc", "utf8");
  assert.doesNotMatch(config, /"kv_namespaces"|"d1_databases"|"services"/, "the public Worker has no storage and no link to the admin Worker");
});

// ---------- public: forms ----------
const formReq = (fields, headers = {}) => new Request("https://api.cattell.com/form", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": ip(), ...headers }, body: new URLSearchParams(fields) });

test("forms: check answers, email them through Resend, and send people back to the website", async () => {
  assert.ok(validateForm({ form: "contact", message: "Hi", email: "a@b.co" }).values);
  assert.match(validateForm({ form: "contact", message: "Hi", email: "nope" }).error, /email address/);
  assert.match(validateForm({ form: "feedback", where: "Narnia", feedback: "x" }).error, /choose where/);
  assert.match(validateForm({ form: "nope" }).error, /could not be found/);

  const sent = [];
  const send = async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return new Response("{}"); };
  const env = { RESEND_API_KEY: "r", FORM_TO: "james@example.com" };
  const ok = await handleForm(formReq({ form: "contact", message: "Hello <b>", email: "a@b.co" }), env, send);
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get("Location"), "https://www.cattell.com/contact/thanks/");
  assert.equal(sent[0].url, "https://api.resend.com/emails");
  assert.equal(sent[0].body.reply_to, "a@b.co");
  assert.match(sent[0].body.text, /Hello <b>/);

  const trap = await handleForm(formReq({ form: "contact", message: "spam", email: "a@b.co", website: "http://spam" }), env, send);
  assert.equal(trap.headers.get("Location"), "https://www.cattell.com/contact/thanks/");
  assert.equal(sent.length, 1, "the spam trap isn't emailed");

  const bad = await handleForm(formReq({ form: "contact", message: "", email: "a@b.co" }), env, send);
  assert.equal(bad.status, 400);
  const html = await bad.text();
  assert.match(html, /There is a problem/);
  assert.match(html, /<a href="https:\/\/www\.cattell\.com\/contact\/">Go back to the form<\/a>/);
  assert.match(bad.headers.get("Content-Security-Policy"), /default-src 'none'; style-src 'unsafe-inline'/);
  assert.doesNotMatch(html, /<script/);
});

test("forms: the human check is used only when both keys are set, and must come from the website's own form", async () => {
  const resend = [];
  const send = (hostname) => async (url, init) => {
    if (url.includes("turnstile")) return new Response(JSON.stringify({ success: true, hostname }));
    resend.push(init);
    return new Response("{}");
  };
  const env = { RESEND_API_KEY: "r", FORM_TO: "j@example.com", TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "secret" };
  const fields = { form: "contact", message: "Hi", email: "a@b.co" };
  assert.match(await (await handleForm(formReq(fields), env, send("www.cattell.com"))).text(), /complete the &quot;are you human&quot; check/);
  assert.equal((await handleForm(formReq({ ...fields, "cf-turnstile-response": "t" }), env, send("evil.example"))).status, 400, "token from another site");
  assert.equal((await handleForm(formReq({ ...fields, "cf-turnstile-response": "t" }), env, send("www.cattell.com"))).status, 303);
  assert.equal((await handleForm(formReq(fields), { ...env, TURNSTILE_SITE_KEY: "" }, send("x"))).status, 303, "off when only one key is set");
});

// ---------- admin: Cloudflare Access ----------
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const TEAM = "cattell.cloudflareaccess.com";
const AUD = "aud-tag-123";
const b64u = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
function accessJwt(claims = {}, { key = privateKey, kid = "k1" } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u({ alg: "RS256", kid, typ: "JWT" });
  const body = b64u({ aud: [AUD], iss: `https://${TEAM}`, email: "james@example.com", iat: now, nbf: now, exp: now + 3600, ...claims });
  const sig = crypto.sign("sha256", Buffer.from(`${head}.${body}`), key).toString("base64url");
  return `${head}.${body}.${sig}`;
}
const certs = async (url) => { assert.equal(url, `https://${TEAM}/cdn-cgi/access/certs`); return new Response(JSON.stringify({ keys: [jwk] })); };
const accessEnv = { ACCESS_TEAM: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: "James@Example.com" };
const signed = (token, init = {}, url = "https://admin.cattell.com/") => new Request(url, { ...init, headers: { ...(token ? { "Cf-Access-Jwt-Assertion": token } : {}), ...(init.headers || {}) } });

test("admin: Access sign-ins are checked: signature, audience, issuer, expiry and email", async () => {
  resetKeyCache();
  assert.deepEqual(await verifyAccess(signed(accessJwt()), accessEnv, certs), { email: "james@example.com" });
  const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  for (const [why, token] of [
    ["forged", accessJwt({}, { key: other })],
    ["wrong audience", accessJwt({ aud: ["someone-else"] })],
    ["wrong issuer", accessJwt({ iss: "https://evil.cloudflareaccess.com" })],
    ["expired", accessJwt({ exp: Math.floor(Date.now() / 1000) - 3600 })],
    ["not James", accessJwt({ email: "someone@example.com" })],
    ["service token", accessJwt({ email: undefined, common_name: "abc.access" })],
    ["unknown key", accessJwt({}, { kid: "k2" })],
    ["rubbish", "a.b.c"],
  ]) assert.equal(await verifyAccess(signed(token), accessEnv, certs), null, why);
  assert.equal(await verifyAccess(signed(null), accessEnv, certs), null, "no sign-in");
  assert.equal(await verifyAccess(signed(accessJwt()), { ...accessEnv, ACCESS_AUD: "" }, certs), null, "not set up: nobody gets in");
  const none = `${b64u({ alg: "none", kid: "k1" })}.${b64u({ aud: [AUD], iss: `https://${TEAM}`, email: "james@example.com", exp: 9e9 })}.`;
  assert.equal(await verifyAccess(signed(none), accessEnv, certs), null, "unsigned tokens");
});

test("admin: every page and API needs the sign-in, except uploads, which need the archive key", async () => {
  resetKeyCache();
  const assets = { fetch: async () => new Response("<h1>Admin</h1>", { headers: { "Content-Type": "text/html" } }) };
  const env = { ...accessEnv, ASSETS: assets, SESSIONS: null, ARCHIVE_KEY: "k".repeat(40) };
  for (const path of ["/", "/sessions/", "/edit.js", "/api/me", "/api/sessions"]) {
    const res = await adminHandle(signed(null, {}, `https://admin.cattell.com${path}`), env, certs);
    assert.equal(res.status, 403, path);
  }
  assert.equal((await adminHandle(signed(accessJwt(), {}, "https://admin.cattell.com/"), env, certs)).status, 200);
  const me = await adminHandle(signed(accessJwt(), {}, "https://admin.cattell.com/api/me"), env, certs);
  assert.deepEqual(await me.json(), { email: "james@example.com", github: false });
  assert.equal((await adminHandle(signed(accessJwt(), {}, "https://cattell-admin.workers.dev/"), env, certs)).status, 404);
  const upload = await adminHandle(new Request("https://admin.cattell.com/api/upload", { method: "POST", body: "{}" }), env, certs);
  assert.equal(upload.status, 503, "reaches the upload code without Access (no database in this test)");
  const wrongKey = await adminHandle(new Request("https://admin.cattell.com/api/upload", { method: "POST", headers: { Authorization: "Bearer nope" }, body: "{}" }), { ...env, SESSIONS: {} }, certs);
  assert.equal(wrongKey.status, 401);
});

test("admin: changes must come from the admin pages themselves", async () => {
  resetKeyCache();
  const env = { ...accessEnv, SESSIONS: {} };
  const del = (headers) => adminHandle(signed(accessJwt(), { method: "DELETE", headers }, "https://admin.cattell.com/api/session?id=code:abcdefgh"), env, certs);
  assert.equal((await del({})).status, 403, "no header");
  assert.equal((await del({ "X-Admin": "1", Origin: "https://evil.example" })).status, 403, "other site");
  assert.equal(sameSite(new Request("https://admin.cattell.com/api/x", { method: "POST", headers: { "X-Admin": "1", Origin: "https://admin.cattell.com" } })), true);
});

test("admin: every reply is private, never cached, and pages may only run their own scripts", async () => {
  const res = await adminWorker.fetch(new Request("https://admin.cattell.com/"), { ...accessEnv });
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.equal(res.headers.get("X-Robots-Tag"), "noindex, nofollow");
  assert.equal(res.headers.get("Content-Security-Policy"), PAGE_CSP);
  assert.match(PAGE_CSP, /script-src 'self';/);
  assert.match(PAGE_CSP, /require-trusted-types-for 'script'/);
  assert.doesNotMatch(PAGE_CSP, /unsafe/);
});

// ---------- admin: GitHub app and week notes ----------
const appKey = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const pkcs1Pem = appKey.privateKey.export({ type: "pkcs1", format: "pem" });

test("GitHub app: GitHub's PKCS#1 key file works, and the app's sign-in is signed correctly", async () => {
  const der = appKey.privateKey.export({ type: "pkcs1", format: "der" });
  const wrapped = Buffer.from(pkcs1ToPkcs8(new Uint8Array(der)));
  assert.deepEqual(wrapped, appKey.privateKey.export({ type: "pkcs8", format: "der" }));
  await importPrivateKey(appKey.privateKey.export({ type: "pkcs8", format: "pem" })); // the other format works too
  const jwt = await appJwt({ GITHUB_APP_ID: "12345", GITHUB_APP_PRIVATE_KEY: pkcs1Pem }, Date.UTC(2026, 10, 18));
  const [h, b, s] = jwt.split(".");
  assert.ok(crypto.verify("sha256", Buffer.from(`${h}.${b}`), appKey.publicKey, Buffer.from(s, "base64url")));
  const claims = JSON.parse(Buffer.from(b, "base64url"));
  assert.equal(claims.iss, "12345");
  assert.ok(claims.exp - claims.iat <= 600, "GitHub allows at most 10 minutes");
});

test("week notes: read and written in the site's format, with title and date from the week", () => {
  const text = buildNote({ year: 2026, week: 7, summary: 'A "quoted" week', other: ["draft: false"], body: "Hello\r\n\nWorld  \n\n" });
  assert.equal(text, '---\ntitle: "Week 7, 2026"\ndate: "2026-02-09"\nsummary: "A \\"quoted\\" week"\ndraft: false\n---\n\nHello\n\nWorld\n');
  assert.deepEqual(parseNote(text), { summary: 'A "quoted" week', other: ["draft: false"], body: "Hello\n\nWorld\n" });
  assert.equal(isoWeekStart(2026, 1), "2025-12-29");
  assert.equal(isoWeekStart(2026, 53), "2026-12-28");
  for (const bad of ["---", "a\nb", "title: Hacked", "date: 2001-01-01", "summary: x", "x".repeat(501)]) assert.equal(safeFrontMatterLine(bad), false, bad);
});

test("week notes: lists, opens and saves notes in the repo as the GitHub app", async () => {
  resetTokenCache();
  const files = new Map([["content/week-notes/2026/46.md", buildNote({ year: 2026, week: 46, summary: "S", body: "Body" })]]);
  const calls = [];
  const send = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", auth: init.headers?.Authorization, body: init.body && JSON.parse(init.body) });
    if (url.endsWith("/access_tokens")) return new Response(JSON.stringify({ token: "inst-token", expires_at: new Date(Date.now() + 3600e3).toISOString() }), { status: 201 });
    const path = decodeURIComponent(new URL(url).pathname.replace("/repos/jacattell/cattell.com/contents/", ""));
    if (url.includes("/git/trees/")) return new Response(JSON.stringify({ tree: [...files.keys()].map((p) => ({ path: p })).concat([{ path: "content/week-notes/2026/_index.md" }]) }));
    if ((init.method || "GET") === "GET") return files.has(path) ? new Response(JSON.stringify({ sha: "abc", content: Buffer.from(files.get(path)).toString("base64") })) : new Response("{}", { status: 404 });
    const body = JSON.parse(init.body);
    if (files.has(path) && !body.sha) return new Response("{}", { status: 422 });
    files.set(path, base64ToUtf8(body.content));
    return new Response(JSON.stringify({ content: { sha: "new" }, commit: { html_url: "https://github.com/c/1" } }), { status: 201 });
  };
  const env = { GITHUB_APP_ID: "1", GITHUB_APP_INSTALLATION_ID: "2", GITHUB_APP_PRIVATE_KEY: pkcs1Pem, REPO: "jacattell/cattell.com" };
  const api = (action, init = {}, q = "") => handleNotes(action, new Request(`https://admin.cattell.com/api/${action}${q}`, init), env, send);

  assert.deepEqual((await (await api("notes")).json()).notes, [{ path: "2026/46", year: 2026, week: 46 }]);
  const note = await (await api("note", {}, "?path=2026/46")).json();
  assert.equal(note.summary, "S");
  assert.equal((await api("note", {}, "?path=../../etc")).status, 400);
  assert.equal((await api("note", {}, "?path=2026/54")).status, 400);

  const put = (body) => api("note", { method: "PUT", body: JSON.stringify(body) });
  const saved = await put({ path: "2027/1", summary: "New year", body: "First note of 2027" });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).url, "https://www.cattell.com/week-notes/2027/1/");
  assert.match(files.get("content/week-notes/2027/_index.md"), /title: "Week notes 2027"/, "a new year gets its list page");
  assert.match(files.get("content/week-notes/2027/1.md"), /^---\ntitle: "Week 1, 2027"\ndate: "2027-01-04"\nsummary: "New year"\n---\n\nFirst note of 2027\n$/);
  assert.equal((await put({ path: "2026/46", body: "x" })).status, 409, "won't overwrite without the sha");
  assert.equal((await put({ path: "2026/45", body: "x", other: ["---\nevil: true"] })).status, 400);
  assert.equal((await put({ path: "2026/45", body: "  " })).status, 400);
  assert.ok(calls.filter((c) => c.url.startsWith("https://api.github.com/repos/")).every((c) => c.auth === "Bearer inst-token"), "uses the app's installation key");
  const tokenCall = calls.find((c) => c.url.endsWith("/access_tokens"));
  assert.deepEqual(tokenCall.body, { repositories: ["cattell.com"], permissions: { contents: "write" } }, "the key can only change this repo's files");
});

test("editor preview: Markdown is rendered, but no HTML or unsafe links get through", () => {
  const html = renderMarkdown('# Title\n\nHi **there** [site](https://www.cattell.com) <script>alert(1)</script>\n\n[x](javascript:alert(1)) [y](JAVASCRIPT:alert(1)) [z](//evil.example) ![p](data:image/svg+xml,x)\n\n<img src=x onerror=alert(1)>\n\n- one\n- two');
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>there<\/strong>/);
  assert.match(html, /<a href="https:\/\/www\.cattell\.com">site<\/a>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.doesNotMatch(html, /<script|<img src=x|<[^>]*onerror=|href="javascript|href="\/\/|src="data:/i);
  assert.match(html, /&lt;script&gt;/, "HTML is shown as text");
  for (const bad of ["javascript:x", " javascript:x", "//evil.example", "data:text/html,x", "vbscript:x"]) assert.equal(safeUrl(bad), null, bad);
  for (const ok of ["https://a.b", "mailto:a@b.c", "/week-notes/", "#top"]) assert.equal(safeUrl(ok), ok);
});
