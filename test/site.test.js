// Checks the built website in public/ (npm test builds it first). No packages.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const OUT = "public";
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const pages = walk(OUT).filter((f) => f.endsWith(".html") && !f.includes(`${path.sep}assets${path.sep}`));
const read = (f) => fs.readFileSync(f, "utf8");
const page = (url) => read(path.join(OUT, url, url.endsWith(".html") ? "" : "index.html"));
const headers = read(path.join(OUT, "_headers"));
const csp = /Content-Security-Policy: (.+)/.exec(headers)[1];

test("the site has its main pages", () => {
  for (const url of ["/", "/delivery/", "/week-notes/", "/week-notes/2026/46/", "/week-notes/2026/", "/unconference/", "/unconference/basics/", "/archive/", "/archive/2012/page-2/", "/chat/", "/contact/", "/contact/thanks/", "/feedback/", "/feedback/thanks/", "/accessibility/", "/privacy/", "/hidden/", "/hidden/bitwarden-desktop-upgrade/", "/404.html"]) {
    assert.ok(fs.existsSync(path.join(OUT, url, url.endsWith(".html") ? "" : "index.html")), url);
  }
  assert.ok(pages.length > 250, `${pages.length} pages`);
});

test("every page: language, title, one main heading, skip link, landmarks", () => {
  const titles = new Map();
  for (const f of pages) {
    const html = read(f);
    assert.match(html, /<html lang="en-GB">/, f);
    const title = /<title>([^<]+)<\/title>/.exec(html)?.[1];
    assert.ok(title && title.trim(), `${f} has a title`);
    if (!f.endsWith("404.html")) {
      assert.ok(!titles.has(title), `${f} and ${titles.get(title)} have the same title: ${title}`);
      titles.set(title, f);
    }
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, `${f} has one h1`);
    assert.match(html, /<a class="skip-link" href="#main">Skip to main content<\/a>/, f);
    assert.match(html, /<main id="main"/, f);
    assert.match(html, /<nav class="wrap site-nav" aria-label="Main">/, f);
    assert.match(html, /<meta name="viewport" content="width=device-width, ?initial-scale=1">/, f);
    assert.doesNotMatch(html, /user-scalable|maximum-scale/, `${f} lets people zoom`);
  }
});

test("every page: headings don't skip levels", () => {
  for (const f of pages) {
    const levels = [...read(f).matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
    for (let i = 1; i < levels.length; i++) assert.ok(levels[i] <= levels[i - 1] + 1, `${f}: h${levels[i - 1]} then h${levels[i]}`);
  }
});

test("every image has a text description (or is marked as decoration)", () => {
  for (const f of pages) for (const img of read(f).match(/<img\b[^>]*>/g) || []) assert.match(img, /\balt=["']/, `${f}: ${img}`);
});

test("every link has text, and no link opens a new tab without saying so", () => {
  for (const f of pages) {
    for (const [, attrs, text] of read(f).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
      const label = text.replace(/<img\b[^>]*alt=(?:"([^"]*)"|'([^']*)')[^>]*>/g, "$1$2").replace(/<[^>]+>/g, "").trim();
      assert.ok(label || /aria-label="[^"]+"/.test(attrs), `${f}: empty link ${attrs}`);
      if (/target="_blank"/.test(attrs)) assert.match(text, /new tab/, `${f}: ${attrs}`);
    }
  }
});

test("form fields all have labels", () => {
  for (const f of pages) {
    const html = read(f);
    for (const [, attrs] of html.matchAll(/<(?:input|textarea|select)\b([^>]*)>/g)) {
      if (/type="(hidden|submit)"/.test(attrs)) continue;
      const id = /\bid="([^"]+)"/.exec(attrs)?.[1];
      if (/type="(radio|checkbox)"/.test(attrs)) continue; // wrapped in their <label>
      assert.ok(id && html.includes(`for="${id}"`), `${f}: field without a label: ${attrs}`);
    }
  }
});

test("security: no inline scripts, inline styles or style attributes anywhere (so the CSP can forbid them)", () => {
  for (const f of pages) {
    const html = read(f);
    for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      assert.ok(!body.trim(), `${f} has an inline script`);
      assert.match(attrs, /src="\/js\/[^"]+\.js" integrity="sha256-/, `${f}: scripts are this site's own, with an integrity check`);
    }
    assert.doesNotMatch(html, /<style[\s>]/, `${f} has an inline style block`);
    assert.doesNotMatch(html, /\sstyle="/, `${f} has a style attribute`);
    assert.doesNotMatch(html, /\son[a-z]+="/i, `${f} has an inline event handler`);
    assert.doesNotMatch(html, /<iframe|<object|<embed/, `${f} embeds another site`);
  }
});

test("security: pages load nothing from other websites", () => {
  for (const f of pages) {
    const html = read(f);
    for (const [, src] of html.matchAll(/<(?:img|script|link|source|video|audio)\b[^>]*\b(?:src|href)="([^"]+)"/g)) {
      if (/rel="(alternate|canonical)"/.test(html.slice(html.indexOf(src) - 200, html.indexOf(src)))) continue;
      assert.ok(src.startsWith("/") && !src.startsWith("//"), `${f} loads ${src}`);
    }
  }
});

test("security: the CSP is strict and every page gets it", () => {
  assert.match(headers, /^\/\*\n  Content-Security-Policy:/m);
  for (const part of ["default-src 'none'", "script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com;", "style-src 'self';", "img-src 'self';", "form-action 'self' https://api.cattell.com;", "base-uri 'none'", "object-src 'none'", "frame-ancestors 'none'"]) {
    assert.ok(csp.includes(part), `CSP has ${part}`);
  }
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|\*/);
  for (const h of ["X-Content-Type-Options: nosniff", "X-Frame-Options: DENY", "Referrer-Policy: strict-origin-when-cross-origin", "Cross-Origin-Opener-Policy: same-origin", "Permissions-Policy:"]) assert.ok(headers.includes(h), h);
});

test("security: Markdown can't add HTML; videos are plain links", () => {
  assert.match(read("hugo.toml"), /unsafe = false/);
  for (const f of walk("content").filter((f) => f.endsWith(".md"))) assert.doesNotMatch(read(f), /<(script|iframe|form|style|object)\b/i, f);
  assert.match(page("/week-notes/2025/42/"), /<a href="https:\/\/www\.youtube\.com\/watch\?v=hHxgruAozjo">Watch “Chill out room at Pensions UK 2025” on YouTube<\/a>/);
});

test("forms post to the API address, with a spam trap, and nothing else", () => {
  for (const url of ["/contact/", "/feedback/"]) {
    const html = page(url);
    assert.match(html, /<form class="site-form" method="post" action="https:\/\/api\.cattell\.com\/form">/);
    assert.match(html, /<div class="trap" aria-hidden="true">/);
    assert.match(html, /href="\/privacy\/"|not stored on this website/);
  }
  assert.match(page("/contact/"), /autocomplete="email"/);
});

test("the feedback form lists the same places the API accepts", async () => {
  const { WORKED_ON } = await import("../workers/public/src/forms.js");
  const yaml = read("data/forms.yaml");
  for (const place of WORKED_ON) assert.match(page("/feedback/"), new RegExp(`value="${place}"`));
  assert.deepEqual([...yaml.matchAll(/^  - (.+)$/gm)].map((m) => m[1]), WORKED_ON);
});

test("the chat page talks to the API, and reads the reply out once", () => {
  const html = page("/chat/");
  assert.match(html, /data-api="https:\/\/api\.cattell\.com\/chat"/);
  assert.match(html, /<p id="chat-announce" class="visually-hidden" role="status">/);
  assert.doesNotMatch(html, /aria-live="polite" aria-label="Conversation"/, "the log isn't read out word by word");
  assert.match(html, /kept for 30 days/);
});

test("week notes: titles, dates, newest first, and older/newer links", () => {
  const note = page("/week-notes/2026/46/");
  assert.match(note, /<h1>Week 46, 2026<\/h1>/);
  assert.match(note, /Week starting <time datetime="2026-11-09">Monday 9 November 2026<\/time>/);
  assert.match(note, /<a class="pager-older" href="\/week-notes\/2026\/14\/" rel="prev"><span class="pager-label">Older<\/span> Week 14, 2026<\/a>/);
  assert.doesNotMatch(note, /pager-newer/, "the newest note has no newer link");
  assert.match(page("/week-notes/2026/14/"), /<a class="pager-newer" href="\/week-notes\/2026\/46\/" rel="next"><span class="pager-label">Newer<\/span> Week 46, 2026<\/a>/);
  const index = page("/week-notes/");
  assert.ok(index.indexOf("Week 46, 2026") < index.indexOf("Week 14, 2026"), "newest first");
  assert.match(page("/week-notes/2024/"), /Goal for the year:<\/strong> Come to terms with/);
  const home = page("/");
  assert.match(home, /<h2 id="latest-notes">Latest week notes<\/h2>/);
  assert.equal((home.match(/class="note-summary"|<li>\s*<a href="\/week-notes\/20/g) || []).length > 0, true);
});

test("the week notes feed lists the newest notes", () => {
  const feed = read(path.join(OUT, "week-notes", "feed.xml"));
  assert.match(feed, /^<\?xml version="1.0" encoding="utf-8"\?>\s*<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom"/);
  assert.match(feed, /<link rel="self" href="https:\/\/www\.cattell\.com\/week-notes\/feed\.xml"\/>/);
  assert.match(feed, /<title>Week 46, 2026: Job search \+ Claude Code<\/title>/);
  assert.equal((feed.match(/<entry>/g) || []).length, 20);
});

test("old addresses redirect, including every old week note address and the old admin pages", () => {
  const r = read(path.join(OUT, "_redirects"));
  assert.match(r, /^\/weeknotes \/week-notes\/ 301$/m);
  assert.match(r, /^\/week-notes\/2026-week-07 \/week-notes\/2026\/7\/ 301$/m);
  assert.match(r, /^\/week-notes\/2026-week-7\/ \/week-notes\/2026\/7\/ 301$/m);
  assert.match(r, /^\/edit\/sessions https:\/\/admin\.cattell\.com\/sessions\/ 301$/m);
  assert.match(r, /^\/govuk\/\* \/ 301$/m);
});

test("hidden pages and thank-you pages are kept out of search engines and the sitemap", () => {
  for (const url of ["/hidden/", "/hidden/bitwarden-desktop-upgrade/", "/contact/thanks/"]) assert.match(page(url), /<meta name="robots" content="noindex, nofollow">/, url);
  assert.doesNotMatch(page("/"), /<meta name="robots"/);
  const sitemap = read(path.join(OUT, "sitemap.xml"));
  assert.doesNotMatch(sitemap, /\/hidden\/|\/(contact|feedback)\/thanks\/|\/archive\/20/);
  assert.match(sitemap, /https:\/\/www\.cattell\.com\/delivery\//);
});

test("the AI chat's reading list has the website and the archive, and nothing private", () => {
  const text = read(path.join(OUT, "chat-context.txt"));
  assert.match(text, /^WEBSITE: https:\/\/www\.cattell\.com\//);
  assert.match(text, /WORK WITH ME \(https:\/\/www\.cattell\.com\/delivery\/\)/);
  assert.match(text, /- Week 46, 2026: https:\/\/www\.cattell\.com\/week-notes\/2026\/46\/ - Job search \+ Claude Code/);
  assert.match(text, /SOCIAL MEDIA ARCHIVE/);
  assert.ok(text.length > 200_000 && text.length < 400_000, `${text.length} characters`);
  assert.doesNotMatch(text, /admin\.cattell\.com|Claude sessions/i);
});

test("the archive shows only local pictures, and its search data matches", () => {
  const html = page("/archive/");
  assert.match(html, /<form class="archive-search" role="search" hidden>/);
  for (const [, src] of html.matchAll(/<img src="([^"]+)"/g)) assert.ok(src.startsWith("/assets/archive/"), src);
  const posts = JSON.parse(read(path.join(OUT, "archive", "posts.json")));
  assert.ok(posts.length > 40000);
  for (const p of posts) for (const pic of p.pictures) assert.ok(pic.src.startsWith("/") && fs.existsSync(path.join("static", pic.src)), pic.src);
});

test("the accessibility statement and privacy notice are linked from every page", () => {
  for (const f of pages) {
    const html = read(f);
    assert.match(html, /<a href="\/accessibility\/">Accessibility<\/a>/, f);
    assert.match(html, /<a href="\/privacy\/">Privacy<\/a>/, f);
  }
  assert.match(page("/accessibility/"), /WCAG\) version 2\.2/);
});

test("the build needs no npm packages", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(read(".hugo-version").trim().split(".").length, 3);
});
